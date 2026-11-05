/**
 * The every-minute reminder sender (app/api/push/due/route.ts) with
 * REMINDER_NOTIFY_CHANNEL and the claim in lib/telegram/reminder-claims.ts:
 *
 *   1. two overlapping runs → exactly one Telegram send
 *   2. a run that crashes after Telegram accepted the message → the takeover
 *      does not send again, and marks the reminder delivered
 *   3. Telegram failing on "telegram" → web push fallback, with is_sent /
 *      delivery_status exactly what a web-push-only reminder gets today
 *   4. other users' reminders → no claim, no Telegram, today's writes
 *   5. a reminder is never marked sent when nothing was delivered
 *
 * The REAL route runs; web-push, the Telegram client and the database are
 * fakes. This proves the decisions and the writes, not delivery itself.
 *
 * Run:  node scripts/test-telegram-reminders.mjs
 */
import { compileTs } from "./lib/compile-ts.mjs";
import { createFakeSupabase } from "./lib/fake-supabase.mjs";

let failures = 0;
let checks = 0;
function eq(label, actual, expected) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log("  ok    " + label);
  else {
    failures++;
    console.log("  FAIL  " + label + "\n        expected " + e + "\n        actual   " + a);
  }
}

const { load } = compileTs(["app/api/push/due/route.ts"], {
  label: "telegram-reminders",
  stubs: {
    "web-push": `
      const webpush = {
        setVapidDetails() {},
        async sendNotification(sub, payload, opts) { return globalThis.__webpush(sub, payload, opts); },
      };
      export default webpush;`,
    "@/lib/api/response": `export function json(body, status = 200) { return { body, status }; }`,
    "@/lib/supabase/admin": `export function createAdminClient() { return globalThis.__dueDb; }`,
    "@/lib/telegram/client": `
      export class TelegramApiError extends Error {
        constructor(method, code, description) { super(description); this.method = method; this.code = code; this.description = description; }
      }
      globalThis.__TelegramApiError = TelegramApiError;
      export function createTelegramApi(token) { return globalThis.__tg(token); }`,
  },
});
const { POST } = await load("app/api/push/due/route.ts");
const TelegramApiError = globalThis.__TelegramApiError;

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const BOT_ENV = {
  TELEGRAM_BOT_TOKEN: "tok",
  TELEGRAM_ALLOWED_CHAT_ID: "424242",
  TELEGRAM_WEBHOOK_SECRET: "sec",
  PRISM_OWNER_USER_ID: OWNER,
};

function setEnv(vars) {
  for (const k of [...Object.keys(BOT_ENV), "REMINDER_NOTIFY_CHANNEL"]) delete process.env[k];
  Object.assign(process.env, { CRON_SECRET: "cron", VAPID_SUBJECT: "x", NEXT_PUBLIC_VAPID_PUBLIC_KEY: "x", VAPID_PRIVATE_KEY: "x" }, vars);
}

const past = (ms = 60_000) => new Date(Date.now() - ms).toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * devices: "none" | "ok" | "fail" (a 500 from the push service) | "expired" (410)
 * telegram: "ok" | "fail"
 */
function world({ reminders, devices = {}, telegram = "ok", claims = [], tgDelayMs = 0 }) {
  let n = 0;
  const subs = [];
  for (const [userId, mode] of Object.entries(devices)) {
    if (mode !== "none") subs.push({ id: `sub-${userId}`, user_id: userId, endpoint: `https://push.example/${userId}/${mode}`, p256dh: "k", auth: "a" });
  }
  const db = createFakeSupabase(
    {
      reminders: reminders.map((r) => ({ is_sent: false, delivery_status: "pending", body: null, remind_at: past(), ...r })),
      push_subscriptions: subs,
      push_delivery_log: [],
      push_health: [],
      reminder_send_claims: claims.map((c) => ({ ...c })),
    },
    {
      defaults: {
        reminder_send_claims: () => ({ id: `claim-${++n}`, telegram_message_id: null, created_at: new Date().toISOString() }),
        push_delivery_log: () => ({ id: `log-${++n}` }),
      },
      uniques: { reminder_send_claims: [["reminder_id"]] },
    }
  );
  const pushes = [];
  const tgSends = [];
  globalThis.__dueDb = db;
  globalThis.__webpush = async (sub) => {
    const mode = sub.endpoint.split("/").pop();
    pushes.push({ endpoint: sub.endpoint, ok: mode === "ok" });
    if (mode === "ok") return { statusCode: 201 };
    const err = new Error(mode);
    err.statusCode = mode === "expired" ? 410 : 500;
    err.body = mode;
    throw err;
  };
  globalThis.__tg = () => ({
    async sendMessage(chatId, text) {
      if (tgDelayMs) await sleep(tgDelayMs);
      if (telegram === "fail") throw new TelegramApiError("sendMessage", 403, "Forbidden: bot was blocked by the user");
      tgSends.push({ chatId, text });
      return { message_id: 700 + tgSends.length };
    },
  });
  return { db, pushes, tgSends };
}

async function run() {
  const origErr = console.error;
  const origWarn = console.warn;
  const logs = [];
  console.error = (...a) => logs.push(a.join(" "));
  console.warn = (...a) => logs.push(a.join(" "));
  try {
    const res = await POST(new Request("http://prism.test/api/push/due", { method: "POST", headers: { "x-cron-secret": "cron" } }));
    return { data: res.body.data, logs };
  } finally {
    console.error = origErr;
    console.warn = origWarn;
  }
}

const state = (db, id) => {
  const r = db.tables.reminders.find((x) => x.id === id);
  return { is_sent: r.is_sent, delivery_status: r.delivery_status };
};

// ═══════════════════════════════════════════════════════════════════════════
console.log("\n1. two overlapping runs → exactly one send");
for (const channel of ["telegram", "both"]) {
  setEnv({ ...BOT_ENV, REMINDER_NOTIFY_CHANNEL: channel });
  const w = world({ reminders: [{ id: "r1", user_id: OWNER, title: "Dinner" }], devices: { [OWNER]: "ok" }, tgDelayMs: 20 });
  await Promise.all([run(), run()]);
  const invocations = w.db.tables.push_delivery_log.filter((l) => l.event === "invocation").map((l) => l.reminders_matched);
  eq(`[${channel}] both runs matched the same reminder (a real overlap)`, invocations, [1, 1]);
  eq(`[${channel}] exactly one Telegram message`, w.tgSends.length, 1);
  eq(`[${channel}] web push sent ${channel === "both" ? "once" : "never"}`, w.pushes.length, channel === "both" ? 1 : 0);
  eq(`[${channel}] delivered once`, [state(w.db, "r1"), w.db.tables.push_delivery_log.filter((l) => l.event === "mark_sent").length], [{ is_sent: true, delivery_status: "delivered" }, 1]);
  eq(`[${channel}] one claim, holding the Telegram message id`, w.db.tables.reminder_send_claims.map((c) => [c.reminder_id, c.telegram_message_id]), [["r1", 701]]);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log("\n2. crash after a successful Telegram send → no resend");
{
  setEnv({ ...BOT_ENV, REMINDER_NOTIFY_CHANNEL: "both" });
  const w = world({ reminders: [{ id: "r1", user_id: OWNER, title: "Dinner" }], devices: { [OWNER]: "ok" } });
  // Run 1: Telegram accepts, then the "mark sent" write is lost (the crash).
  w.db.failOn("reminders", "update", "instance froze");
  await run();
  eq("run 1: Telegram sent once", w.tgSends.length, 1);
  eq("run 1: the mark was lost — the reminder still reads pending", state(w.db, "r1"), { is_sent: false, delivery_status: "pending" });
  eq("run 1: the claim recorded the Telegram message", w.db.tables.reminder_send_claims[0].telegram_message_id, 701);
  const pushesAfterRun1 = w.pushes.length;

  await run();
  eq("next minute: the claim is fresh → the reminder is left alone", [w.tgSends.length, w.pushes.length, state(w.db, "r1").is_sent], [1, pushesAfterRun1, false]);

  w.db.tables.reminder_send_claims[0].claimed_at = past(6 * 60_000);
  await run();
  eq("after 5 min: takeover sends NOTHING on Telegram", w.tgSends.length, 1);
  eq("… and nothing by web push either", w.pushes.length, pushesAfterRun1);
  eq("… and marks the reminder delivered", state(w.db, "r1"), { is_sent: true, delivery_status: "delivered" });
}
{
  setEnv({ ...BOT_ENV, REMINDER_NOTIFY_CHANNEL: "telegram" });
  // A crash BEFORE Telegram accepted (no message id on the stale claim).
  const w = world({
    reminders: [{ id: "r1", user_id: OWNER, title: "Dinner" }],
    claims: [{ id: "claim-old", user_id: OWNER, reminder_id: "r1", claimed_at: past(6 * 60_000), telegram_message_id: null }],
  });
  await run();
  eq("stale claim WITHOUT a message id → taken over and sent, once", [w.tgSends.length, state(w.db, "r1")], [1, { is_sent: true, delivery_status: "delivered" }]);
  eq("… on the same claim row", w.db.tables.reminder_send_claims.map((c) => [c.id, c.telegram_message_id]), [["claim-old", 701]]);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log("\n3. Telegram fails on REMINDER_NOTIFY_CHANNEL=telegram → web push, fields exactly as today");
for (const devices of ["ok", "none", "fail", "expired"]) {
  setEnv({ ...BOT_ENV, REMINDER_NOTIFY_CHANNEL: "telegram" });
  const w = world({
    reminders: [
      { id: "mine", user_id: OWNER, title: "Dinner" },
      { id: "today", user_id: OTHER, title: "Same devices, web push only" },
    ],
    devices: { [OWNER]: devices, [OTHER]: devices },
    telegram: "fail",
  });
  const { logs } = await run();
  eq(`[devices ${devices}] owner's reminder ends exactly like a web-push-only one`, state(w.db, "mine"), state(w.db, "today"));
  eq(`[devices ${devices}] web push was tried for the owner`, w.pushes.filter((p) => p.endpoint.includes(OWNER)).length, devices === "none" ? 0 : 1);
  eq(
    `[devices ${devices}] the reason is logged (Telegram's words, no token)`,
    logs.some((l) => l.includes("bot was blocked") && l.includes("trying web push instead")) && !logs.some((l) => l.includes("tok")),
    true
  );
  const delivered = devices === "ok";
  eq(
    `[devices ${devices}] claim ${delivered ? "kept (delivered)" : "released (next minute retries)"}`,
    w.db.tables.reminder_send_claims.length,
    delivered ? 1 : 0
  );
  eq(
    `[devices ${devices}] the Telegram attempt is in push_delivery_log`,
    w.db.tables.push_delivery_log.filter((l) => l.subscription_endpoint === "telegram").map((l) => [l.event, l.ok, l.status_code]),
    [["attempt", false, 403]]
  );
}
{
  setEnv({ ...BOT_ENV, REMINDER_NOTIFY_CHANNEL: "telegram" });
  const w = world({ reminders: [{ id: "mine", user_id: OWNER, title: "Dinner" }], devices: { [OWNER]: "fail" }, telegram: "fail" });
  await run();
  w.tgSends.length = 0;
  globalThis.__tg = () => ({ async sendMessage() { return { message_id: 9 }; } });
  await run();
  eq("nothing delivered → the next minute retries Telegram", state(w.db, "mine"), { is_sent: true, delivery_status: "delivered" });
}

// ═══════════════════════════════════════════════════════════════════════════
console.log("\n4. other users' reminders: no claim, no Telegram, today's writes");
for (const channel of ["telegram", "both", "webpush"]) {
  for (const devices of ["ok", "none", "fail", "expired"]) {
    setEnv({ ...BOT_ENV, REMINDER_NOTIFY_CHANNEL: channel });
    const w = world({ reminders: [{ id: "r", user_id: OTHER, title: "Theirs" }], devices: { [OTHER]: devices } });
    await run();
    const expected = { ok: { is_sent: true, delivery_status: "delivered" }, none: { is_sent: false, delivery_status: "skipped_no_device" }, fail: { is_sent: false, delivery_status: "pending" }, expired: { is_sent: false, delivery_status: "pending" } }[devices];
    eq(`[${channel}, devices ${devices}] no Telegram, no claim; fields as today`, [w.tgSends.length, w.db.tables.reminder_send_claims.length, state(w.db, "r")], [0, 0, expected]);
    if (devices === "expired") eq(`[${channel}] an expired device is still pruned`, w.db.tables.push_subscriptions.length, 0);
  }
}
{
  setEnv({ ...BOT_ENV, REMINDER_NOTIFY_CHANNEL: "webpush" });
  const w = world({ reminders: [{ id: "mine", user_id: OWNER, title: "Dinner" }], devices: { [OWNER]: "ok" } });
  await run();
  eq("owner on webpush → the old path exactly: no claim, no Telegram", [w.tgSends.length, w.db.tables.reminder_send_claims.length, state(w.db, "mine").is_sent], [0, 0, true]);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log("\n5. never marked sent when nothing was delivered");
let matrix = 0;
let violations = 0;
for (const channel of ["telegram", "both", "webpush"]) {
  for (const tg of ["ok", "fail"]) {
    for (const devices of ["ok", "none", "fail", "expired"]) {
      setEnv({ ...BOT_ENV, REMINDER_NOTIFY_CHANNEL: channel });
      const w = world({ reminders: [{ id: "mine", user_id: OWNER, title: "Dinner" }], devices: { [OWNER]: devices }, telegram: tg });
      await run();
      const reached = w.tgSends.length + w.pushes.filter((p) => p.ok).length;
      const s = state(w.db, "mine");
      matrix++;
      const consistent = s.is_sent === reached > 0 && (s.delivery_status === "delivered") === s.is_sent;
      if (!consistent) {
        violations++;
        console.log(`        violation: channel=${channel} telegram=${tg} devices=${devices} → reached ${reached}, ${JSON.stringify(s)}`);
      }
    }
  }
}
eq(`is_sent ⇔ something was delivered, in all ${matrix} channel × Telegram × device cases`, violations, 0);

// ═══════════════════════════════════════════════════════════════════════════
console.log("\nclaims table unusable");
{
  setEnv({ ...BOT_ENV, REMINDER_NOTIFY_CHANNEL: "telegram" });
  const w = world({ reminders: [{ id: "mine", user_id: OWNER, title: "Dinner" }], devices: { [OWNER]: "ok" } });
  w.db.failOn("reminder_send_claims", "upsert", 'relation "reminder_send_claims" does not exist');
  const { logs } = await run();
  eq("no claim → no Telegram (a double can't be ruled out), web push as today", [w.tgSends.length, w.pushes.length, state(w.db, "mine").is_sent], [0, 1, true]);
  eq("… and the log says why", logs.some((l) => l.includes("does not exist") && l.includes("using web push")), true);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
