/**
 * The 11:00 cron (app/api/cron/daily-plan/route.ts) with PLAN_NOTIFY_CHANNEL:
 * who gets Telegram, who gets web push, the fallback when Telegram fails,
 * and that the notified_at claim still stops a re-run sending anything.
 *
 * The REAL route runs; its neighbours are stubbed — the plan builder, the
 * push sender, the Telegram client and the database — so this proves the
 * routing decision, not delivery.
 *
 * Run:  node scripts/test-telegram-cron.mjs
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

const { load } = compileTs(["app/api/cron/daily-plan/route.ts"], {
  label: "telegram-cron",
  stubs: {
    "@/lib/api/response": `export function json(body, status = 200) { return { body, status }; }`,
    "@/lib/supabase/admin": `export function createAdminClient() { return globalThis.__cronDb; }`,
    "@/lib/daily-plan/server": `export async function ensureDailyPlan(db, userId, planDate) { return globalThis.__ensure(db, userId, planDate); }`,
    "@/lib/push/send": `export async function sendPushToUser(userId, payload) { return globalThis.__push(userId, payload); }`,
    "@/lib/telegram/client": `export function createTelegramApi(token) { return globalThis.__tg(token); }`,
  },
});
const { POST } = await load("app/api/cron/daily-plan/route.ts");

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const BOT_ENV = {
  TELEGRAM_BOT_TOKEN: "tok",
  TELEGRAM_ALLOWED_CHAT_ID: "424242",
  TELEGRAM_WEBHOOK_SECRET: "sec",
  PRISM_OWNER_USER_ID: OWNER,
};

function setEnv(vars) {
  for (const k of [...Object.keys(BOT_ENV), "PLAN_NOTIFY_CHANNEL"]) delete process.env[k];
  Object.assign(process.env, { CRON_SECRET: "cron" }, vars);
}

function world({ telegramFails = false } = {}) {
  const db = createFakeSupabase({
    plan_anchors: [
      { id: "a1", user_id: OWNER, is_active: true },
      { id: "a2", user_id: OTHER, is_active: true },
    ],
    daily_plans: [
      { id: "p-owner", user_id: OWNER, plan_date: "2026-11-05", source: "ai", reason: "Gym first.", accepted_at: null, notified_at: null },
      { id: "p-other", user_id: OTHER, plan_date: "2026-11-05", source: "ai", reason: "Read first.", accepted_at: null, notified_at: null },
    ],
  });
  const pushes = [];
  const tgSends = [];
  const logs = [];
  globalThis.__cronDb = db;
  globalThis.__ensure = async (_db, userId) => {
    const plan = db.tables.daily_plans.find((p) => p.user_id === userId);
    return {
      created: false,
      plan: { ...plan },
      view: {
        plan: { id: plan.id, plan_date: plan.plan_date, source: plan.source, reason: plan.reason, accepted_at: plan.accepted_at },
        items: [
          { id: "00000000-0000-4000-8000-000000000001", position: 0, kind: "anchor", title: "Gym", status: "planned", moved_to: null, task_id: null, task_due_date: null, task_done: false, after_title: null, carried: false, gone: false },
        ],
      },
    };
  };
  globalThis.__push = async (userId) => {
    pushes.push(userId);
    return { sent: 1, failed: 0 };
  };
  globalThis.__tg = (token) => ({
    async sendMessage(chatId, text, keyboard) {
      if (telegramFails) throw new Error("Telegram sendMessage failed (401): Unauthorized");
      tgSends.push({ token, chatId, text, keyboard });
      return { message_id: 1 };
    },
  });
  return { db, pushes, tgSends, logs };
}

async function runCron(w) {
  const origErr = console.error;
  const origWarn = console.warn;
  console.error = (...a) => w.logs.push(a.join(" "));
  console.warn = (...a) => w.logs.push(a.join(" "));
  try {
    const res = await POST(new Request("http://prism.test/api/cron/daily-plan", { method: "POST", headers: { "x-cron-secret": "cron" } }));
    return res.body.data.users;
  } finally {
    console.error = origErr;
    console.warn = origWarn;
  }
}

const byUser = (users) => Object.fromEntries(users.map((u) => [u.user_id === OWNER ? "owner" : "other", u]));

console.log("\nPLAN_NOTIFY_CHANNEL unset (= both)");
{
  setEnv(BOT_ENV);
  const w = world();
  const u = byUser(await runCron(w));
  eq("owner: Telegram sent to the allowed chat", w.tgSends.map((s) => [s.chatId, s.token]), [["424242", "tok"]]);
  eq("owner: and web push", w.pushes.includes(OWNER), true);
  eq("owner outcome", [u.owner.telegram, u.owner.push_sent], ["sent", 1]);
  eq("other user: web push only, outcome has no telegram key", [w.pushes.includes(OTHER), "telegram" in u.other], [true, false]);
  eq("the message is the plan, with its buttons", w.tgSends[0].keyboard.at(-1)[0].text, "Looks good");

  const again = byUser(await runCron(w));
  eq("re-run: notified_at claim → nothing sent twice", [w.tgSends.length, w.pushes.length, again.owner.skipped, again.other.skipped], [1, 2, "already_notified", "already_notified"]);
}

console.log("\nPLAN_NOTIFY_CHANNEL=telegram");
{
  setEnv({ ...BOT_ENV, PLAN_NOTIFY_CHANNEL: "telegram" });
  const w = world();
  const u = byUser(await runCron(w));
  eq("owner: Telegram only, no web push", [w.tgSends.length, w.pushes.includes(OWNER)], [1, false]);
  eq("owner outcome: no push counts written", [u.owner.telegram, u.owner.push_sent, w.db.tables.daily_plans[0].push_sent], ["sent", undefined, undefined]);
  eq("other user: still web push", w.pushes, [OTHER]);
}

console.log("\nPLAN_NOTIFY_CHANNEL=telegram, Telegram failing");
{
  setEnv({ ...BOT_ENV, PLAN_NOTIFY_CHANNEL: "telegram" });
  const w = world({ telegramFails: true });
  const u = byUser(await runCron(w));
  eq("owner: falls back to web push", w.pushes.includes(OWNER), true);
  eq("owner outcome says so", [u.owner.telegram, u.owner.push_sent], ["failed", 1]);
  eq(
    "the reason is logged, and the token is not",
    w.logs.some((l) => l.includes("Telegram plan message failed") && l.includes("Unauthorized") && l.includes("sending the web push instead")) &&
      !w.logs.some((l) => l.includes("tok")),
    true
  );
}

console.log("\nPLAN_NOTIFY_CHANNEL=webpush");
{
  setEnv({ ...BOT_ENV, PLAN_NOTIFY_CHANNEL: "webpush" });
  const w = world();
  const u = byUser(await runCron(w));
  eq("owner: web push only, Telegram never called", [w.tgSends.length, w.pushes.includes(OWNER), "telegram" in u.owner], [0, true, false]);
}

console.log("\nPLAN_NOTIFY_CHANNEL=telegram, bot not configured");
{
  setEnv({ PLAN_NOTIFY_CHANNEL: "telegram" });
  const w = world();
  await runCron(w);
  eq("everyone gets web push", w.pushes.sort(), [OWNER, OTHER].sort());
  eq("and the log says why", w.logs.some((l) => l.includes("the bot is not configured")), true);
}

console.log("\nPLAN_NOTIFY_CHANNEL=nonsense");
{
  setEnv({ ...BOT_ENV, PLAN_NOTIFY_CHANNEL: "tg" });
  const w = world();
  await runCron(w);
  eq("an unknown value behaves as both (never silences the morning)", [w.tgSends.length, w.pushes.includes(OWNER)], [1, true]);
  eq("and is logged", w.logs.some((l) => l.includes("PLAN_NOTIFY_CHANNEL is not")), true);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
