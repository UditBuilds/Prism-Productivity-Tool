/**
 * Unit checks for the Telegram bot (phase 1): the two auth gates, the update
 * and callback routers, Save's idempotency, the AI-answer → task/reminder
 * mapping with its IST edge cases, and proof that a plan button writes the
 * same rows as the dashboard card's PATCH.
 *
 * Everything runs against an in-memory fake of the Supabase query builder
 * (scripts/lib/fake-supabase.mjs) and fake Telegram / AI dependencies. No
 * network and no database: these prove the code paths, not Postgres.
 *
 * Calendar used throughout (IST): 2026-11-05 is a THURSDAY.
 *
 * Run:  node scripts/test-telegram.mjs
 */
import { compileTs } from "./lib/compile-ts.mjs";
import { createFakeSupabase } from "./lib/fake-supabase.mjs";

let failures = 0;
let checks = 0;

function eq(label, actual, expected) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log("  ok    " + label);
  } else {
    failures++;
    console.log("  FAIL  " + label + "\n        expected " + e + "\n        actual   " + a);
  }
}

function ok(label, cond, detail = "") {
  eq(label + (detail ? ` (${detail})` : ""), !!cond, true);
}

function section(name) {
  console.log(`\n${name}`);
}

// ─── Load the modules under test ──────────────────────────────────────────

const RESPONSE_STUB = `export function json(body, status = 200) { return { body, status }; }`;
const SERVER_CLIENT_STUB = `export function createClient() { return globalThis.__fakeDb; }`;
const PLAN_SERVER_STUB = `export async function ensureDailyPlan() { throw new Error("not in this test"); }`;

const { load } = compileTs(
  [
    "lib/telegram/env.ts",
    "lib/telegram/auth.ts",
    "lib/telegram/webhook.ts",
    "lib/telegram/callbacks.ts",
    "lib/telegram/callback-data.ts",
    "lib/telegram/capture.ts",
    "lib/telegram/capture-schema.ts",
    "lib/telegram/capture-store.ts",
    "lib/telegram/capture-handlers.ts",
    "lib/telegram/plan-message.ts",
    "lib/telegram/messages.ts",
    "lib/telegram/client.ts",
    "lib/telegram/tap-timing.ts",
    "lib/daily-plan/edit.ts",
    "lib/date.ts",
    "app/api/daily-plan/route.ts",
  ],
  {
    label: "telegram",
    stubs: {
      "@/lib/api/response": RESPONSE_STUB,
      "@/lib/supabase/server": SERVER_CLIENT_STUB,
      "@/lib/daily-plan/server": PLAN_SERVER_STUB,
    },
  }
);

// The real plan read, for the redraw. Its AI imports are never reached here.
const { load: loadPlanServer } = compileTs(["lib/daily-plan/server.ts"], {
  label: "telegram-plan-server",
  stubs: {
    "@/lib/ai/client": `export async function orderDailyPlan() { throw new Error("no AI in a plan read"); }`,
    "@/lib/ai/rateLimit": `export function checkAiRateLimit() { throw new Error("no AI in a plan read"); }`,
  },
});

const { readTelegramEnv, missingTelegramEnv, readNotifyChannel } = await load("lib/telegram/env.ts");
const { isAuthorizedUpdate, chatIdOf } = await load("lib/telegram/auth.ts");
const { handleWebhook } = await load("lib/telegram/webhook.ts");
const { routeCallback, CALLBACK_HANDLERS } = await load("lib/telegram/callbacks.ts");
const { parseCallbackData, MAX_CALLBACK_BYTES } = await load("lib/telegram/callback-data.ts");
const { resolveCapture, resolveWhen, dayText, renderCaptureMessage, NOTHING_TO_SAVE } =
  await load("lib/telegram/capture.ts");
const { validateCaptureAnswer } = await load("lib/telegram/capture-schema.ts");
const { saveCapture, cancelCapture, loadCaptureContext } = await load("lib/telegram/capture-store.ts");
const { handleCaptureMessage } = await load("lib/telegram/capture-handlers.ts");
const { renderPlanMessage, MAX_PLAN_ROWS } = await load("lib/telegram/plan-message.ts");
const messages = await load("lib/telegram/messages.ts");
const { createTelegramApi, TelegramApiError } = await load("lib/telegram/client.ts");
const { createTapTimer } = await load("lib/telegram/tap-timing.ts");
const { readDailyPlanView } = await loadPlanServer("lib/daily-plan/server.ts");
const { applyDailyPlanEdit } = await load("lib/daily-plan/edit.ts");
const { istCivilDateTimeToIso, istClock12 } = await load("lib/date.ts");
const { PATCH } = await load("app/api/daily-plan/route.ts");

// ─── Fixtures ─────────────────────────────────────────────────────────────

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CHAT = 424242;
const ENV = {
  botToken: "test-token",
  allowedChatId: String(CHAT),
  webhookSecret: "s3cret_-ABCdef",
  ownerUserId: OWNER,
};

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = uuid(100); // today's plan
const I_TODAY = uuid(101); // task due today
const I_LEFT = uuid(102); // leftover task (due Nov 3)
const I_ANCHOR = uuid(103); // anchor
const I_MOVED = uuid(104); // already moved
const I_OTHER = uuid(105); // another user's item
const T_TODAY = uuid(201);
const T_LEFT = uuid(202);
const T_MOVED = uuid(203);
const T_OTHER = uuid(204);
const A_GYM = uuid(301);

/** 21:14 IST, Thursday 5 Nov 2026. */
const NOW = Date.parse("2026-11-05T15:44:00Z");

let fakeNow = NOW;
const DEFAULTS = {
  tasks: () => ({
    status: "todo",
    priority: "medium",
    description: null,
    completed_at: null,
    recurring_task_id: null,
    created_at: new Date(fakeNow).toISOString(),
  }),
  reminders: () => ({
    is_sent: false,
    delivery_status: "pending",
    body: null,
    note_id: null,
    created_at: new Date(fakeNow).toISOString(),
  }),
  telegram_captures: () => ({
    status: "pending",
    resolved_at: null,
    reply_message_id: null,
    created_at: new Date(fakeNow).toISOString(),
  }),
};

function planDb() {
  return createFakeSupabase(
    {
      daily_plans: [
        { id: P, user_id: OWNER, plan_date: "2026-11-05", source: "ai", reason: "Gym first.", accepted_at: null },
        { id: uuid(110), user_id: OTHER, plan_date: "2026-11-05", source: "ai", reason: "x", accepted_at: null },
      ],
      daily_plan_items: [
        { id: I_TODAY, user_id: OWNER, plan_id: P, position: 0, kind: "task", task_id: T_TODAY, anchor_id: null, title: "Write report", status: "planned", moved_to: null, status_changed_at: null },
        { id: I_LEFT, user_id: OWNER, plan_id: P, position: 1, kind: "task", task_id: T_LEFT, anchor_id: null, title: "Email landlord", status: "planned", moved_to: null, status_changed_at: null },
        { id: I_ANCHOR, user_id: OWNER, plan_id: P, position: 2, kind: "anchor", task_id: null, anchor_id: A_GYM, title: "Gym", status: "planned", moved_to: null, status_changed_at: null },
        { id: I_MOVED, user_id: OWNER, plan_id: P, position: 3, kind: "task", task_id: T_MOVED, anchor_id: null, title: "Call bank", status: "moved", moved_to: "2026-11-06", status_changed_at: "2026-11-05T05:40:00.000Z" },
        { id: I_OTHER, user_id: OTHER, plan_id: uuid(110), position: 0, kind: "task", task_id: T_OTHER, anchor_id: null, title: "Not yours", status: "planned", moved_to: null, status_changed_at: null },
      ],
      tasks: [
        { id: T_TODAY, user_id: OWNER, title: "Write report", status: "todo", due_date: "2026-11-05T06:30:00.000Z" },
        { id: T_LEFT, user_id: OWNER, title: "Email landlord", status: "todo", due_date: "2026-11-03T06:30:00.000Z" },
        { id: T_MOVED, user_id: OWNER, title: "Call bank", status: "todo", due_date: "2026-11-06T06:30:00.000Z" },
        { id: T_OTHER, user_id: OTHER, title: "Not yours", status: "todo", due_date: "2026-11-03T06:30:00.000Z" },
      ],
    },
    { defaults: DEFAULTS, user: { id: OWNER } }
  );
}

/** A plan read that succeeds, for tests that are not about the redraw's content. */
const emptyView = async (_db, _userId, planId) => ({
  plan: { id: planId, plan_date: "2026-11-05", source: "ai", reason: "r", accepted_at: null },
  items: [],
});

function makeDeps({ db, now = NOW, ai, allow = () => true, plan } = {}) {
  const sent = [];
  const edits = [];
  const answers = [];
  const aiCalls = [];
  let n = 1000;
  const telegram = {
    async sendMessage(chatId, text, keyboard) {
      sent.push({ chatId, text, keyboard });
      return { message_id: 5000 + sent.length };
    },
    async editMessageText(chatId, messageId, text, keyboard) {
      edits.push({ chatId, messageId, text, keyboard });
    },
    async answerCallbackQuery(id, text) {
      answers.push({ id, text });
    },
  };
  const deps = {
    env: ENV,
    db,
    telegram,
    plan: plan ?? { applyEdit: applyDailyPlanEdit, readView: emptyView },
    ai: {
      allow,
      async parseCapture(text, ctx) {
        aiCalls.push({ text, ctx });
        return ai ? ai(text, ctx) : [];
      },
    },
    now: () => now,
    newId: () => uuid(++n),
  };
  return { deps, sent, edits, answers, aiCalls };
}

/** A db that fails the test the moment anything touches it. */
function untouchableDb() {
  const touched = [];
  const db = new Proxy(
    {},
    {
      get(_t, key) {
        touched.push(String(key));
        throw new Error(`db touched: ${String(key)}`);
      },
    }
  );
  return { db, touched };
}

const textUpdate = (text, { chatId = CHAT, messageId = 1 } = {}) => ({
  update_id: messageId,
  message: { message_id: messageId, chat: { id: chatId, type: "private" }, text },
});

const callbackUpdate = (data, { chatId = CHAT, messageId = 77 } = {}) => ({
  update_id: 9000 + messageId,
  callback_query: {
    id: `cb-${messageId}`,
    from: { id: chatId },
    data,
    message: { message_id: messageId, chat: { id: chatId, type: "private" } },
  },
});

const hook = (deps, update, secret = ENV.webhookSecret) =>
  handleWebhook({ secretHeader: secret, rawBody: JSON.stringify(update) }, deps);

// ═══════════════════════════════════════════════════════════════════════════
section("env and channel flags");

eq("all four missing → null", readTelegramEnv({}), null);
eq(
  "all four set → trimmed",
  readTelegramEnv({
    TELEGRAM_BOT_TOKEN: " t ",
    TELEGRAM_ALLOWED_CHAT_ID: "1",
    TELEGRAM_WEBHOOK_SECRET: "s",
    PRISM_OWNER_USER_ID: "u",
  }),
  { botToken: "t", allowedChatId: "1", webhookSecret: "s", ownerUserId: "u" }
);
eq(
  "one blank → null",
  readTelegramEnv({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_ALLOWED_CHAT_ID: "1", TELEGRAM_WEBHOOK_SECRET: " ", PRISM_OWNER_USER_ID: "u" }),
  null
);
eq(
  "missing names listed (names, not values)",
  missingTelegramEnv({ TELEGRAM_BOT_TOKEN: "secret-value" }),
  ["TELEGRAM_ALLOWED_CHAT_ID", "TELEGRAM_WEBHOOK_SECRET", "PRISM_OWNER_USER_ID"]
);
eq("flag unset → both", readNotifyChannel(undefined), { channel: "both", valid: true });
eq("flag telegram", readNotifyChannel("telegram"), { channel: "telegram", valid: true });
eq("flag is trimmed and case-blind", readNotifyChannel(" WebPush "), { channel: "webpush", valid: true });
eq("unknown flag → both, marked invalid", readNotifyChannel("tg"), { channel: "both", valid: false });

// ═══════════════════════════════════════════════════════════════════════════
section("auth gates (pure)");

const goodMsg = textUpdate("hi");
eq("right secret + right chat → allowed", isAuthorizedUpdate(ENV.webhookSecret, goodMsg, ENV), true);
eq("wrong secret → refused", isAuthorizedUpdate("s3cret_-ABCdeX", goodMsg, ENV), false);
eq("missing header → refused", isAuthorizedUpdate(null, goodMsg, ENV), false);
eq("empty header → refused", isAuthorizedUpdate("", goodMsg, ENV), false);
eq("secret prefix only → refused", isAuthorizedUpdate("s3cret", goodMsg, ENV), false);
eq("wrong chat id → refused", isAuthorizedUpdate(ENV.webhookSecret, textUpdate("hi", { chatId: 999 }), ENV), false);
eq("chat id sent as a string → refused", isAuthorizedUpdate(ENV.webhookSecret, { update_id: 1, message: { message_id: 1, chat: { id: "424242" }, text: "x" } }, ENV), false);
eq("button in the right chat → allowed", isAuthorizedUpdate(ENV.webhookSecret, callbackUpdate("p:a:" + P), ENV), true);
eq("button in another chat → refused", isAuthorizedUpdate(ENV.webhookSecret, callbackUpdate("p:a:" + P, { chatId: 1 }), ENV), false);
eq(
  "button with no message (inline mode) → refused",
  isAuthorizedUpdate(ENV.webhookSecret, { update_id: 1, callback_query: { id: "x", data: "p:a:" + P } }, ENV),
  false
);
eq("an edited message (not handled) → refused", isAuthorizedUpdate(ENV.webhookSecret, { update_id: 1, edited_message: goodMsg.message }, ENV), false);
eq("not an object → refused", isAuthorizedUpdate(ENV.webhookSecret, "x", ENV), false);
eq("chatIdOf a callback", chatIdOf(callbackUpdate("p:a:" + P)), CHAT);

// ═══════════════════════════════════════════════════════════════════════════
section("auth gates (whole webhook): a refused update does NOTHING");

for (const [label, update, secret, raw] of [
  ["wrong secret", textUpdate("dinner at 8"), "wrong", null],
  ["missing secret", textUpdate("dinner at 8"), null, null],
  ["wrong chat id", textUpdate("dinner at 8", { chatId: 31337 }), ENV.webhookSecret, null],
  ["wrong chat id on a Save button", callbackUpdate("c:s:" + uuid(1), { chatId: 31337 }), ENV.webhookSecret, null],
  ["unparseable body", null, ENV.webhookSecret, "{not json"],
]) {
  const { db, touched } = untouchableDb();
  const f = makeDeps({ db, ai: () => [{ title: "Dinner", match: null, similar: [], date: null, time: "20:00", time_ambiguous: false }] });
  await handleWebhook({ secretHeader: secret, rawBody: raw ?? JSON.stringify(update) }, f.deps);
  eq(`${label}: no database access`, touched, []);
  eq(`${label}: no AI call`, f.aiCalls.length, 0);
  eq(`${label}: no message sent`, f.sent.length + f.edits.length + f.answers.length, 0);
}

{
  const { db, touched } = untouchableDb();
  const f = makeDeps({ db });
  await hook(f.deps, textUpdate("/start"));
  eq("authorised /start → help text, nothing else", f.sent.map((s) => s.text), [messages.HELP_TEXT]);
  eq("authorised /start → no database access", touched, []);
}
{
  const { db } = untouchableDb();
  const f = makeDeps({ db });
  await hook(f.deps, { update_id: 3, message: { message_id: 3, chat: { id: CHAT } } });
  eq("a photo/voice (no text) → text-only note", f.sent.map((s) => s.text), [messages.TEXT_ONLY]);
}
{
  // A failure after the gates is answered honestly in the chat.
  const { db } = untouchableDb();
  const f = makeDeps({ db });
  await hook(f.deps, textUpdate("dinner at 8"));
  eq("a crash after the gates → one honest message", f.sent.map((s) => s.text), [messages.SOMETHING_WRONG]);
}

// ═══════════════════════════════════════════════════════════════════════════
section("callback data and routing");

eq("parse p:m:<uuid>", parseCallbackData("p:m:" + I_TODAY), { namespace: "p", action: "m", id: I_TODAY });
eq("parse lower-cases the id", parseCallbackData("c:s:" + I_TODAY.toUpperCase()), { namespace: "c", action: "s", id: I_TODAY });
eq("not a uuid → null", parseCallbackData("p:m:12345"), null);
eq("trailing junk → null", parseCallbackData("p:m:" + I_TODAY + ":x"), null);
eq("undefined → null", parseCallbackData(undefined), null);
eq("namespaces registered", Object.keys(CALLBACK_HANDLERS).sort(), ["c", "p"]);

{
  const calls = [];
  const spyPlan = {
    applyEdit: async (_db, userId, body) => {
      calls.push({ userId, body });
      return { status: 200, planId: P, body: { data: { id: "x", status: body.action === "move" ? "moved" : "dropped", accepted_at: "t" }, error: null } };
    },
    readView: emptyView,
  };
  const db = planDb();
  for (const [data, expected, toast] of [
    ["p:a:" + P, { action: "accept", plan_id: P }, "Plan accepted"],
    ["p:m:" + I_TODAY, { action: "move", item_id: I_TODAY }, "Moved to tomorrow"],
    ["p:d:" + I_TODAY, { action: "drop", item_id: I_TODAY }, "Dropped"],
  ]) {
    const f = makeDeps({ db, plan: spyPlan });
    await routeCallback(callbackUpdate(data).callback_query, f.deps);
    eq(`${data.slice(0, 3)} → plan edit ${expected.action}, as the owner`, calls.at(-1), { userId: OWNER, body: expected });
    eq(`${data.slice(0, 3)} → answered "${toast}"`, f.answers.map((a) => a.text), [toast]);
  }
  const before = calls.length;
  const f = makeDeps({ db, plan: spyPlan });
  await routeCallback(callbackUpdate("z:a:" + P).callback_query, f.deps);
  eq("unknown namespace → no handler runs", calls.length, before);
  eq("unknown namespace → 'expired' toast", f.answers.map((a) => a.text), [messages.BUTTON_EXPIRED]);
  const g = makeDeps({ db, plan: spyPlan });
  await routeCallback({ id: "q", data: "garbage", message: { message_id: 1, chat: { id: CHAT } } }, g.deps);
  eq("garbage data → still answered", g.answers.map((a) => a.text), [messages.BUTTON_EXPIRED]);
  const x = makeDeps({ db, plan: spyPlan });
  const beforeUnknown = calls.length;
  await routeCallback(callbackUpdate("p:z:" + P).callback_query, x.deps);
  eq("unknown action letter → no handler runs", calls.length, beforeUnknown);
  eq("unknown action letter → 'expired' toast", x.answers.map((a) => a.text), [messages.BUTTON_EXPIRED]);
  const h = makeDeps({
    db,
    plan: { applyEdit: async () => { throw new Error("boom"); }, readView: emptyView },
  });
  const thrown = await captureErrors(() => routeCallback(callbackUpdate("p:m:" + I_TODAY).callback_query, h.deps));
  eq("a handler that throws → already answered, never left spinning", h.answers.map((a) => a.text), ["Moved to tomorrow"]);
  eq("… and the chat is told", h.sent.map((s) => s.text), [messages.COULDNT_SAVE]);
  ok("… and it is logged", thrown.some((l) => l.includes("boom")));
}

// ═══════════════════════════════════════════════════════════════════════════
section("plan buttons write the SAME rows as the dashboard card's PATCH");

/** Timestamps differ between the two runs (different clocks); compare the rest. */
function stable(tables) {
  const copy = JSON.parse(JSON.stringify(tables));
  for (const rows of Object.values(copy)) {
    for (const r of rows) {
      for (const k of ["accepted_at", "status_changed_at"]) {
        if (r[k] && !String(r[k]).startsWith("2026-11-05T05:40")) r[k] = "<stamped>";
      }
    }
  }
  return copy;
}
function stableLog(log) {
  return log.map((l) => ({
    table: l.table,
    op: l.op,
    ids: l.ids,
    values: Object.fromEntries(
      Object.entries(l.values ?? {}).map(([k, v]) => [k, k.endsWith("_at") ? "<stamped>" : v])
    ),
  }));
}

const PLAN_CASES = [
  ["accept", "p:a:" + P, { action: "accept", plan_id: P }],
  ["move a task due today", "p:m:" + I_TODAY, { action: "move", item_id: I_TODAY }],
  ["drop today's task", "p:d:" + I_TODAY, { action: "drop", item_id: I_TODAY }],
  ["drop a leftover", "p:d:" + I_LEFT, { action: "drop", item_id: I_LEFT }],
  ["move a leftover", "p:m:" + I_LEFT, { action: "move", item_id: I_LEFT }],
  ["drop an anchor", "p:d:" + I_ANCHOR, { action: "drop", item_id: I_ANCHOR }],
  ["move an anchor", "p:m:" + I_ANCHOR, { action: "move", item_id: I_ANCHOR }],
  ["tap on an item already moved", "p:d:" + I_MOVED, { action: "drop", item_id: I_MOVED }],
  ["another user's item", "p:m:" + I_OTHER, { action: "move", item_id: I_OTHER }],
];

for (const [label, data, body] of PLAN_CASES) {
  const appDb = planDb();
  globalThis.__fakeDb = appDb;
  const res = await PATCH(
    new Request("http://prism.test/api/daily-plan", { method: "PATCH", body: JSON.stringify(body) })
  );

  const botDb = planDb();
  const f = makeDeps({ db: botDb });
  await hook(f.deps, callbackUpdate(data));

  eq(`${label}: same rows`, stable(botDb.tables), stable(appDb.tables));
  eq(`${label}: same writes, same order`, stableLog(botDb.log), stableLog(appDb.log));
  eq(`${label}: button answered`, f.answers.length, 1);
  if (label === "another user's item") {
    eq(`${label}: app says 404`, res.status, 404);
    eq(`${label}: bot says so`, f.sent.map((s) => s.text), ["That item isn't on a plan any more."]);
    eq(`${label}: their rows untouched`, botDb.log.length, 0);
  }
}

{
  // The effects themselves, so "same" is not "same and both wrong".
  const db = planDb();
  const f = makeDeps({ db });
  await hook(f.deps, callbackUpdate("p:m:" + I_TODAY));
  eq("move → task re-dated to tomorrow, noon IST", db.tables.tasks.find((t) => t.id === T_TODAY).due_date, "2026-11-06T06:30:00.000Z");
  eq("move → item moved to 2026-11-06", (({ status, moved_to }) => ({ status, moved_to }))(db.tables.daily_plan_items.find((i) => i.id === I_TODAY)), { status: "moved", moved_to: "2026-11-06" });
  await hook(f.deps, callbackUpdate("p:d:" + I_LEFT));
  eq("drop a leftover → its date cleared", db.tables.tasks.find((t) => t.id === T_LEFT).due_date, null);
  eq("drop a leftover → item dropped", db.tables.daily_plan_items.find((i) => i.id === I_LEFT).status, "dropped");
  await hook(f.deps, callbackUpdate("p:d:" + I_ANCHOR));
  eq("drop an anchor → recorded as skipped", db.tables.daily_plan_items.find((i) => i.id === I_ANCHOR).status, "skipped");
  await hook(f.deps, callbackUpdate("p:a:" + P));
  ok("Looks good → plan accepted", db.tables.daily_plans.find((p) => p.id === P).accepted_at);
  const writes = db.log.length;
  await hook(f.deps, callbackUpdate("p:d:" + I_ANCHOR));
  await hook(f.deps, callbackUpdate("p:a:" + P));
  eq("a double tap writes nothing new (accept is first-wins)", db.log.filter((l) => l.ids?.length).length, db.log.slice(0, writes).filter((l) => l.ids?.length).length);
}

// ═══════════════════════════════════════════════════════════════════════════
section("plan message");

function viewItem(over) {
  return { id: uuid(400), position: 0, kind: "task", title: "Task", status: "planned", moved_to: null, task_id: uuid(401), task_due_date: "2026-11-05T06:30:00.000Z", task_done: false, after_title: null, carried: false, gone: false, ...over };
}
{
  const view = {
    plan: { id: P, plan_date: "2026-11-05", source: "ai", reason: "Gym first <today>.", accepted_at: null },
    items: [
      viewItem({ id: uuid(410), kind: "anchor", title: "Gym", task_id: null, task_due_date: null }),
      viewItem({ id: uuid(411), title: "Write <b>report</b> & send" }),
      viewItem({ id: uuid(412), title: "Paid rent", task_done: true }),
      viewItem({ id: uuid(413), title: "Moved one", status: "moved", moved_to: "2026-11-06" }),
    ],
  };
  const { text, keyboard } = renderPlanMessage(view);
  ok("titles are HTML-escaped", text.includes("Write &lt;b&gt;report&lt;/b&gt; &amp; send"));
  ok(
    "the reason is escaped too",
    renderPlanMessage({ ...view, items: view.items.filter((i) => i.status === "planned") }).text.includes("Gym first &lt;today&gt;.")
  );
  ok("a done task is struck through", text.includes("<s>Paid rent</s> — Done"));
  ok("moved rows are counted, not listed", text.includes("2 left · 1 moved") && !text.includes("Moved one"));
  eq(
    "buttons: Move/Drop per open row, then one Looks good",
    keyboard.map((row) => row.map((b) => b.text)),
    [["1 · Move to tomorrow", "1 · Drop"], ["2 · Move to tomorrow", "2 · Drop"], ["Looks good"]]
  );
  eq("Looks good is the plan-level accept", keyboard.at(-1)[0].callback_data, "p:a:" + P);
  ok(
    "every button fits Telegram's 64-byte limit",
    keyboard.flat().every((b) => Buffer.byteLength(b.callback_data, "utf8") <= MAX_CALLBACK_BYTES)
  );
  ok("no guilt words", !/overdue|must|should|haven't/i.test(text));

  const accepted = renderPlanMessage({ ...view, plan: { ...view.plan, accepted_at: "2026-11-05T05:34:00.000Z" } });
  ok("accepted → no Looks good button", !accepted.keyboard.flat().some((b) => b.text === "Looks good"));
  ok("accepted → says when (IST)", accepted.text.includes("Plan accepted at 11:04"));

  const many = {
    plan: view.plan,
    items: Array.from({ length: 13 }, (_, i) => viewItem({ id: uuid(500 + i), title: `Task ${i + 1}` })),
  };
  const big = renderPlanMessage(many);
  eq(`13 rows → ${MAX_PLAN_ROWS} with buttons`, big.keyboard.length - 1, MAX_PLAN_ROWS);
  ok("… and the rest counted", big.text.includes("+3 more in Prism"));
  ok("over the day cap → the card's plain note", big.text.includes("13 tasks today. A realistic day is about 5."));
}

// ═══════════════════════════════════════════════════════════════════════════
section("plan message: the count line and Plan cleared");

const REASON = "Gym first, then the rest.";
const planOf = (items, over = {}) => ({
  plan: { id: P, plan_date: "2026-11-05", source: "ai", reason: REASON, accepted_at: null, ...over },
  items,
});
const anchorRow = (n, over = {}) =>
  viewItem({ id: uuid(600 + n), kind: "anchor", title: `Anchor ${n}`, task_id: null, task_due_date: null, ...over });
const taskRow = (n, over = {}) => viewItem({ id: uuid(620 + n), title: `Task ${n}`, ...over });
const AS_MOVED = { status: "moved", moved_to: "2026-11-06" };
const AS_LEFTOVER = { task_due_date: "2026-11-03T06:30:00.000Z" };
const AT_1104 = "2026-11-05T05:34:00.000Z";
const subline = (m) => m.text.split("\n")[1];
const buttonText = (m) => m.keyboard.flat().map((b) => b.text);

{
  const first = renderPlanMessage(planOf([anchorRow(1), anchorRow(2), taskRow(1)]));
  eq("untouched: the stored summary stays", subline(first), REASON);
  ok("untouched: Looks good is there", buttonText(first).includes("Looks good"));
  ok("untouched: not cleared", !first.text.includes("Plan cleared"));

  const tapped = renderPlanMessage(planOf([anchorRow(1), anchorRow(2)], { accepted_at: AT_1104 }));
  eq("Looks good alone is not an edit: the summary stays", subline(tapped), REASON);

  const leftovers = renderPlanMessage(planOf([taskRow(1, AS_LEFTOVER), taskRow(2)]));
  eq("untouched with a leftover: PR #90's header stays", subline(leftovers), "1 left over · 1 for today");

  const moved = renderPlanMessage(planOf([anchorRow(1, AS_MOVED), anchorRow(2), taskRow(1)]));
  eq("after a Move: counts", subline(moved), "2 left · 1 moved");
  ok("after a Move: the summary is gone", !moved.text.includes(REASON));
  ok("the old footer is gone", !moved.text.includes("moved to tomorrow"));

  eq(
    "a skipped anchor reads as dropped",
    subline(renderPlanMessage(planOf([anchorRow(1, { status: "skipped" }), anchorRow(2)]))),
    "1 left · 1 dropped"
  );
  eq(
    "all three parts",
    subline(renderPlanMessage(planOf([anchorRow(1, AS_MOVED), anchorRow(2, { status: "skipped" }), taskRow(1)]))),
    "1 left · 1 moved · 1 dropped"
  );
  eq(
    "an edit replaces the leftover header too",
    subline(renderPlanMessage(planOf([taskRow(1, AS_LEFTOVER), taskRow(2, AS_MOVED)]))),
    "1 left · 1 moved"
  );
}

{
  // The shape of the real plan of 2026-11-05: two anchors, both off the plan.
  const cleared = renderPlanMessage(planOf([anchorRow(1, AS_MOVED), anchorRow(2, { status: "skipped" })]));
  ok("every item off → Plan cleared", cleared.text.includes("<b>Plan cleared</b>"));
  eq("… with the count line", subline(cleared), "1 moved · 1 dropped");
  eq("… and no buttons at all", cleared.keyboard, []);
  ok("… and no claim it was accepted", !cleared.text.includes("Plan accepted"));
  ok("… and not the older wording", !cleared.text.includes("Nothing left"));
  ok("… and no summary", !cleared.text.includes(REASON));

  const doneRow = renderPlanMessage(planOf([taskRow(1, { task_done: true }), taskRow(2, AS_MOVED)]));
  ok("a done row does not block Plan cleared", doneRow.text.includes("Plan cleared"));
  ok("… and is still shown, struck through", doneRow.text.includes("<s>Task 1</s>"));
  eq("… with no buttons", doneRow.keyboard, []);

  const doneOnly = renderPlanMessage(planOf([taskRow(1, { task_done: true }), taskRow(2, { task_done: true })]));
  ok("cleared by Done alone → Plan cleared", doneOnly.text.includes("Plan cleared"));
  ok("… with no summary, and no empty count line", !doneOnly.text.includes(REASON) && subline(doneOnly) === "");
  eq("… with no buttons", doneOnly.keyboard, []);

  const doneLeftover = renderPlanMessage(planOf([taskRow(1, { ...AS_LEFTOVER, task_done: true }), taskRow(2, AS_MOVED)]));
  ok("a done leftover (its group closed) + a move → Plan cleared", doneLeftover.text.includes("Plan cleared"));
  eq("… with no buttons", doneLeftover.keyboard, []);

  const accepted = renderPlanMessage(
    planOf([anchorRow(1, AS_MOVED), anchorRow(2, { status: "skipped" })], { accepted_at: AT_1104 })
  );
  ok("cleared AND accepted → says when it was accepted", accepted.text.includes("Plan accepted at 11:04"));
  ok("… not Plan cleared", !accepted.text.includes("Plan cleared"));
  eq("… keeps the count line", subline(accepted), "1 moved · 1 dropped");
  eq("… with no buttons", accepted.keyboard, []);

  const deletedOnly = renderPlanMessage(planOf([taskRow(1, { gone: true })]));
  ok("only a deleted row, no edit → not cleared", !deletedOnly.text.includes("Plan cleared") && deletedOnly.text.includes("Nothing left"));
  ok("… and no Looks good", !buttonText(deletedOnly).includes("Looks good"));
  ok(
    "a deleted row + an open row → still open",
    buttonText(renderPlanMessage(planOf([taskRow(1, { gone: true }), anchorRow(1)]))).includes("Looks good")
  );
  ok(
    "a deleted row + a move → cleared (the deleted row stays 'planned' forever)",
    renderPlanMessage(planOf([taskRow(1, { gone: true, task_id: null }), anchorRow(1, AS_MOVED)])).text.includes("Plan cleared")
  );

  // Rows past the first ten have no button until the rows above leave.
  const rows = Array.from({ length: 12 }, (_, i) => taskRow(i, i < 11 ? AS_MOVED : {}));
  const lastOne = renderPlanMessage(planOf(rows));
  eq("row 12 of 12 reaches a button once the others have gone", buttonText(lastOne), ["1 · Move to tomorrow", "1 · Drop", "Looks good"]);
  const allOff = renderPlanMessage(planOf(rows.map((r) => ({ ...r, ...AS_MOVED }))));
  ok("… so a long plan can still be cleared", allOff.text.includes("Plan cleared") && allOff.keyboard.length === 0);
}

// ═══════════════════════════════════════════════════════════════════════════
section("plan buttons: what a tap does to the message and the database");

/** readDailyPlanView's result, read from the fake tables (server.ts is stubbed here). */
function viewFromDb(db) {
  return async (_db, userId, planId) => {
    const plan = db.tables.daily_plans.find((p) => p.id === planId && p.user_id === userId);
    if (!plan) return null;
    const items = db.tables.daily_plan_items
      .filter((i) => i.plan_id === planId && i.user_id === userId)
      .sort((a, b) => a.position - b.position)
      .map((i) => {
        const task = i.task_id ? db.tables.tasks.find((t) => t.id === i.task_id) : undefined;
        return {
          id: i.id,
          position: i.position,
          kind: i.kind,
          title: i.title,
          status: i.status,
          moved_to: i.moved_to,
          task_id: task ? task.id : null,
          task_due_date: task?.due_date ?? null,
          task_done: task?.status === "done",
          after_title: null,
          carried: false,
          gone: i.kind === "task" ? !task : !i.anchor_id,
        };
      });
    const { id, plan_date, source, reason, accepted_at } = plan;
    return { plan: { id, plan_date, source, reason, accepted_at }, items };
  };
}
const botDeps = (db, now = NOW) =>
  makeDeps({ db, now, plan: { applyEdit: applyDailyPlanEdit, readView: viewFromDb(db) } });
/** Writes to daily_plans that actually changed a row. */
const planWrites = (db) => db.log.filter((l) => l.table === "daily_plans" && l.ids?.length);
const acceptedAt = (db) => db.tables.daily_plans.find((p) => p.id === P).accepted_at;

async function captureErrors(fn) {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return logged;
}

{
  // The fixture opens with one row already moved, and three still planned.
  const db = planDb();
  const f = botDeps(db);
  await hook(f.deps, callbackUpdate("p:d:" + I_ANCHOR));
  eq("drop an anchor → counts", subline(f.edits.at(-1)), "2 left · 1 moved · 1 dropped");
  await hook(f.deps, callbackUpdate("p:m:" + I_TODAY));
  eq("move a task → counts", subline(f.edits.at(-1)), "1 left · 2 moved · 1 dropped");
  ok("the last open row still has its buttons", f.edits.at(-1).keyboard.length === 2);

  await hook(f.deps, callbackUpdate("p:d:" + I_LEFT));
  const last = f.edits.at(-1);
  ok("the last row off → Plan cleared", last.text.includes("Plan cleared"));
  eq("… with the count line", subline(last), "2 moved · 2 dropped");
  eq("… and every button removed", last.keyboard, []);
  eq("… and the tap answered as usual", f.answers.at(-1).text, "Dropped");
  eq("accepted_at stays NULL: clearing is not accepting", acceptedAt(db), null);
  eq("nothing wrote to daily_plans", planWrites(db), []);

  const rows = JSON.stringify(db.tables);
  const writes = db.log.length;
  const again = botDeps(db, NOW + 60_000);
  await hook(again.deps, callbackUpdate("p:d:" + I_LEFT));
  await hook(again.deps, callbackUpdate("p:d:" + I_LEFT));
  await hook(again.deps, callbackUpdate("p:m:" + I_TODAY));
  eq("repeated callbacks: no row changes, not even a timestamp", JSON.stringify(db.tables), rows);
  eq("repeated callbacks: no writes", db.log.length, writes);
  eq("repeated callbacks: the same message each time", again.edits.map((e) => e.text), [last.text, last.text, last.text]);
  eq("repeated callbacks: each one answered", again.answers.length, 3);
}

{
  // Pass 2 of the live test: Looks good first, then clear the rest an hour later.
  const db = planDb();
  const tap = Date.parse(AT_1104);
  await hook(botDeps(db, tap).deps, callbackUpdate("p:a:" + P));
  eq("Looks good stamps the tap's time", acceptedAt(db), AT_1104);

  const later = botDeps(db, tap + 3_600_000);
  for (const data of ["p:m:" + I_TODAY, "p:d:" + I_LEFT, "p:d:" + I_ANCHOR]) {
    await hook(later.deps, callbackUpdate(data));
  }
  eq("clearing afterwards keeps the Looks good time", acceptedAt(db), AT_1104);
  eq("the accept is the only write to daily_plans", planWrites(db).length, 1);
  ok("the message says when it was accepted", later.edits.at(-1).text.includes("Plan accepted at 11:04"));
  eq("… and has no buttons", later.edits.at(-1).keyboard, []);

  await hook(later.deps, callbackUpdate("p:a:" + P));
  eq("a second accept changes nothing", acceptedAt(db), AT_1104);
}

{
  // The app's own path, including the one action only the card has.
  const db = planDb();
  globalThis.__fakeDb = db;
  const res = await PATCH(
    new Request("http://prism.test/api/daily-plan", {
      method: "PATCH",
      body: JSON.stringify({ action: "move_all", item_ids: [I_TODAY, I_LEFT, I_ANCHOR] }),
    })
  );
  eq("the card's Move all clears the plan", res.status, 200);
  ok(
    "… every row off",
    db.tables.daily_plan_items.filter((i) => i.user_id === OWNER).every((i) => i.status === "moved")
  );
  eq("… and accepted_at stays NULL", acceptedAt(db), null);
  eq("… with no write to daily_plans", planWrites(db), []);
}

{
  // A leftover finished in the app: the tasks route changes the task and knows
  // nothing about the plan, so this is the only way the message can learn of it.
  const db = planDb();
  const f = botDeps(db);
  await hook(f.deps, callbackUpdate("p:m:" + I_TODAY));
  await hook(f.deps, callbackUpdate("p:d:" + I_ANCHOR));
  eq("one leftover still open", subline(f.edits.at(-1)), "1 left · 2 moved · 1 dropped");

  db.tables.tasks.find((t) => t.id === T_LEFT).status = "done";
  const redrawn = renderPlanMessage(await viewFromDb(db)(db, OWNER, P));
  ok("marked Done in the app → the next draw reads Plan cleared", redrawn.text.includes("Plan cleared"));
  eq("… with no buttons", redrawn.keyboard, []);
  eq("… and accepted_at still NULL", acceptedAt(db), null);

  await hook(f.deps, callbackUpdate("p:a:" + P));
  ok("the message's old Looks good is still a real accept", acceptedAt(db));
  ok("… and the redraw says so", f.edits.at(-1).text.includes("Plan accepted at"));
}

{
  const db = planDb();
  const f = botDeps(db);
  f.deps.telegram.editMessageText = async () => {
    throw new Error("Telegram editMessageText failed (400): message to edit not found");
  };
  const logged = await captureErrors(() => hook(f.deps, callbackUpdate("p:m:" + I_TODAY)));
  eq("Telegram edit fails → the move stands", db.tables.daily_plan_items.find((i) => i.id === I_TODAY).status, "moved");
  eq("… the task is re-dated", db.tables.tasks.find((t) => t.id === T_TODAY).due_date, "2026-11-06T06:30:00.000Z");
  ok("… the failure is logged with Telegram's reason", logged.some((l) => l.includes("redraw failed") && l.includes("message to edit not found")));
  eq("… the tap was answered", f.answers.map((a) => a.text), ["Moved to tomorrow"]);
  eq("… and the chat hears the truth: saved, not redrawn", f.sent.map((s) => s.text), ["Saved, but I couldn't update this message."]);

  const g = makeDeps({
    db,
    plan: {
      applyEdit: applyDailyPlanEdit,
      readView: async () => {
        throw new Error("daily plan by id: boom");
      },
    },
  });
  const readLogged = await captureErrors(() => hook(g.deps, callbackUpdate("p:d:" + I_ANCHOR)));
  eq("the re-read fails → the drop stands", db.tables.daily_plan_items.find((i) => i.id === I_ANCHOR).status, "skipped");
  ok("… and that is logged too", readLogged.some((l) => l.includes("redraw failed") && l.includes("boom")));
  eq("… the tap was answered", g.answers.map((a) => a.text), ["Dropped"]);
  eq("… and the chat hears the same truth", g.sent.map((s) => s.text), ["Saved, but I couldn't update this message."]);
}

// ═══════════════════════════════════════════════════════════════════════════
section("IST date + time helpers");

eq("20:00 IST on 5 Nov → 14:30Z", istCivilDateTimeToIso("2026-11-05", "20:00"), "2026-11-05T14:30:00.000Z");
eq("00:10 IST on 6 Nov → 18:40Z on 5 Nov", istCivilDateTimeToIso("2026-11-06", "00:10"), "2026-11-05T18:40:00.000Z");
eq("05:29 IST → previous UTC day", istCivilDateTimeToIso("2026-11-06", "05:29"), "2026-11-05T23:59:00.000Z");
eq("not a real date → null", istCivilDateTimeToIso("2026-02-30", "10:00"), null);
eq("24:10 → null", istCivilDateTimeToIso("2026-11-05", "24:10"), null);
eq("12-hour clock label", istClock12("2026-11-05T14:30:00.000Z"), "8:00 PM");

// ═══════════════════════════════════════════════════════════════════════════
section("AI answer validation");

const REFS = new Set(["t1", "t2", "a1"]);
eq("no items array → throws", (() => { try { validateCaptureAnswer({}, REFS, "2026-11-05"); return "no throw"; } catch { return "threw"; } })(), "threw");
eq("empty items → [] (\"lol ok\")", validateCaptureAnswer({ items: [] }, REFS, "2026-11-05"), []);
eq(
  "bad fields drop to safe values",
  validateCaptureAnswer(
    { items: [{ title: "  Dinner ", match: "t9", similar: ["t1", "t1", "zz", "a1", "t2", "t1"], date: "2026-11-04", time: "25:00", time_ambiguous: true }] },
    REFS,
    "2026-11-05"
  ),
  [{ title: "Dinner", match: null, similar: ["t1", "a1", "t2"], date: null, time: null, time_ambiguous: false }]
);
eq(
  "the match ref is never also 'similar'",
  validateCaptureAnswer({ items: [{ title: "Gym", match: "a1", similar: ["a1", "t1"], date: "2026-11-05", time: "19:00" }] }, REFS, "2026-11-05")[0],
  { title: "Gym", match: "a1", similar: ["t1"], date: "2026-11-05", time: "19:00", time_ambiguous: false }
);
eq("a date 3 years out → null", validateCaptureAnswer({ items: [{ title: "x", date: "2029-12-01" }] }, REFS, "2026-11-05")[0].date, null);
eq("untitled items are dropped", validateCaptureAnswer({ items: [{ title: "" }, { title: "ok" }] }, REFS, "2026-11-05").length, 1);
eq("at most 10 items", validateCaptureAnswer({ items: Array.from({ length: 14 }, () => ({ title: "x" })) }, REFS, "2026-11-05").length, 10);

// ═══════════════════════════════════════════════════════════════════════════
section("AI answer → what Save writes (IST edge cases)");

const item = (over) => ({ title: "Dinner", match: null, similar: [], date: null, time: null, time_ambiguous: false, ...over });
let idc = 0;
const ctxAt = (nowMs, tasks = new Map(), anchors = new Map()) => ({ nowMs, tasks, anchors, newId: () => uuid(9000 + ++idc) });

{
  const [op] = resolveCapture([item({ time: "20:00" })], ctxAt(NOW));
  eq("(a) 'dinner at 8' at 21:14 → task tomorrow", [op.op, op.due_date], ["create_task", "2026-11-06"]);
  eq("(a) … reminder tomorrow 20:00 IST", op.reminder.remind_at, "2026-11-06T14:30:00.000Z");
  eq("(a) … and it says why", op.note, "8:00 PM today has passed, so I set it for tomorrow.");
}
{
  const at19 = Date.parse("2026-11-05T13:30:00Z"); // 19:00 IST
  const [op] = resolveCapture([item({ time: "20:00" })], ctxAt(at19));
  eq("'dinner at 8' at 19:00 → today, 20:00", [op.due_date, op.reminder.remind_at, op.note], ["2026-11-05", "2026-11-05T14:30:00.000Z", null]);
}
{
  const [op] = resolveCapture([item({ date: "2026-11-05", time: "20:00" })], ctxAt(NOW));
  eq("'tonight at 8' at 21:14 → today, no reminder", [op.due_date, op.reminder], ["2026-11-05", null]);
  eq("… and it says so", op.note, "8:00 PM has already passed, so there's no reminder.");
}
{
  const at10 = Date.parse("2026-11-05T04:30:00Z"); // 10:00 IST
  const at7 = Date.parse("2026-11-05T01:30:00Z"); // 07:00 IST
  const at21 = Date.parse("2026-11-05T15:30:00Z"); // 21:00 IST
  const amb = item({ title: "Call", time: "08:00", time_ambiguous: true });
  eq("'call at 8' at 10:00 → tonight 8 PM", resolveCapture([amb], ctxAt(at10))[0].reminder.remind_at, "2026-11-05T14:30:00.000Z");
  eq("'call at 8' at 07:00 → this morning 8 AM", resolveCapture([amb], ctxAt(at7))[0].reminder.remind_at, "2026-11-05T02:30:00.000Z");
  eq("'call at 8' at 21:00 → tomorrow 8 AM", resolveCapture([amb], ctxAt(at21))[0].reminder.remind_at, "2026-11-06T02:30:00.000Z");
}
{
  const at2350 = Date.parse("2026-11-05T18:20:00Z"); // 23:50 IST Thu
  const [op] = resolveCapture([item({ title: "Meds", time: "00:30", time_ambiguous: true })], ctxAt(at2350));
  eq("near midnight: 'at 12:30' at 23:50 → 00:30 on the NEXT IST day", [op.due_date, op.reminder.remind_at], ["2026-11-06", "2026-11-05T19:00:00.000Z"]);
  const [noon] = resolveCapture([item({ title: "Lunch", time: "12:30", time_ambiguous: true })], ctxAt(at2350));
  eq("… while a plain 12:30 reads as 12:30 PM (12 has no am/pm twin) → tomorrow 12:30 PM", noon.reminder.remind_at, "2026-11-06T07:00:00.000Z");
  eq("near midnight: the date line says (tomorrow)", dayText("2026-11-06", at2350), "Fri, Nov 6 (tomorrow)");
}
{
  const at0020 = Date.parse("2026-11-05T18:50:00Z"); // 00:20 IST Fri 6 Nov (UTC is still the 5th)
  eq("at 00:20 IST, 'today' is already the 6th", dayText("2026-11-06", at0020), "Fri, Nov 6 (today)");
  eq("… so 'tomorrow' (the 7th) is labelled so", dayText("2026-11-07", at0020), "Sat, Nov 7 (tomorrow)");
}
{
  // 21:14:15 IST; 21:15 is 45 s away — inside the one-minute lead.
  const [op] = resolveCapture([item({ time: "21:15" })], ctxAt(NOW + 15_000));
  eq("a time under a minute away counts as passed → tomorrow", op.due_date, "2026-11-06");
}
{
  const tasks = new Map([
    ["t1", { id: T_TODAY, title: "Call dentist", due: "2026-11-09", pendingReminder: null }],
    ["t2", { id: T_LEFT, title: "Email landlord", due: "2026-11-03", pendingReminder: { id: uuid(600), remind_at: "2026-11-09T11:30:00.000Z" } }],
  ]);
  const anchors = new Map([["a1", { id: A_GYM, title: "Gym" }]]);
  const ctx = ctxAt(NOW, tasks, anchors);

  const [gym] = resolveCapture([item({ title: "Gym", match: "a1", time: "19:00" })], ctx);
  eq("(b) 'gym moved to 7pm' at 21:14 → reminder only, tomorrow 7 PM", [gym.op, gym.title, gym.reminder.remind_at], ["anchor_reminder", "Gym", "2026-11-06T13:30:00.000Z"]);
  const at10 = Date.parse("2026-11-05T04:30:00Z");
  const [gym10] = resolveCapture([item({ title: "Gym", match: "a1", time: "19:00" })], ctxAt(at10, tasks, anchors));
  eq("(b) at 10:00 → today 7 PM, the anchor itself untouched", [gym10.op, gym10.anchor_id, gym10.reminder.remind_at], ["anchor_reminder", A_GYM, "2026-11-05T13:30:00.000Z"]);
  eq("(b) 'gym tomorrow' (no time) → shown, not saved", resolveCapture([item({ title: "Gym", match: "a1", date: "2026-11-06" })], ctx)[0].op, "none");

  const [dent] = resolveCapture([item({ title: "Dentist", match: "t1", date: "2026-11-10" })], ctx);
  eq("(c) a clear match + a day → re-date THAT task", [dent.op, dent.task_id, dent.due_date, dent.reminder], ["update_task", T_TODAY, "2026-11-10", null]);
  const [dent5] = resolveCapture([item({ title: "Dentist", match: "t1", time: "17:00" })], ctx);
  eq("(c) match + a time, no day → reminder on the task's own day", [dent5.due_date, dent5.reminder.remind_at, dent5.reminder.existing], [null, "2026-11-09T11:30:00.000Z", false]);
  const [land] = resolveCapture([item({ title: "Landlord", match: "t2", time: "10:00" })], ctx);
  eq("(c) overdue task + a time → re-dated to that day, its ONE pending reminder moved", [land.due_date, land.reminder.id, land.reminder.existing, land.reminder.remind_at], ["2026-11-06", uuid(600), true, "2026-11-06T04:30:00.000Z"]);
  eq("(c) a match with nothing to change → shown, not saved", resolveCapture([item({ title: "Dentist", match: "t1" })], ctx)[0].op, "none");
  const [unsure] = resolveCapture([item({ title: "Dentist", similar: ["t1"] })], ctx);
  eq("(c) unsure → saved as NEW, similar shown by title", [unsure.op, unsure.similar], ["create_task", [{ title: "Call dentist", due: "2026-11-09" }]]);
  const text = renderCaptureMessage([unsure], "pending", NOW);
  ok("(c) … and the line names it", text.includes("Similar: “Call dentist” (Mon, Nov 9)"));
}
eq("(d) 'lol ok' → nothing", resolveCapture([], ctxAt(NOW)), []);

// ═══════════════════════════════════════════════════════════════════════════
section("capture flow: nothing is written before Save; Save is idempotent");

const DINNER = () => [item({ time: "20:00" })];

function captureDb(extra = {}) {
  return createFakeSupabase(
    {
      tasks: [
        { id: T_TODAY, user_id: OWNER, title: "Call dentist", status: "todo", due_date: "2026-11-09T06:30:00.000Z", created_at: "2026-11-01T00:00:00.000Z" },
        { id: T_LEFT, user_id: OWNER, title: "Email landlord", status: "todo", due_date: "2026-11-03T06:30:00.000Z", created_at: "2026-11-01T00:00:00.000Z" },
        { id: uuid(205), user_id: OWNER, title: "Finished", status: "done", due_date: null, created_at: "2026-11-01T00:00:00.000Z" },
        { id: T_OTHER, user_id: OTHER, title: "Someone else's", status: "todo", due_date: null, created_at: "2026-11-01T00:00:00.000Z" },
      ],
      plan_anchors: [
        { id: A_GYM, user_id: OWNER, title: "Gym", is_active: true, position: 0 },
        { id: uuid(302), user_id: OWNER, title: "Old anchor", is_active: false, position: 1 },
      ],
      reminders: [
        { id: uuid(600), user_id: OWNER, title: "Email landlord", task_id: T_LEFT, remind_at: "2026-11-09T11:30:00.000Z", is_sent: false, delivery_status: "pending" },
      ],
      telegram_captures: [],
      ...extra,
    },
    { defaults: DEFAULTS, uniques: { telegram_captures: [["chat_id", "source_message_id"]] } }
  );
}

{
  const db = captureDb();
  const ctx = await loadCaptureContext(db, OWNER, NOW);
  eq("context: open tasks only, the owner's only", ctx.promptTasks.map((t) => t.title), ["Email landlord", "Call dentist"]);
  eq("context: refs, never ids", ctx.promptTasks.map((t) => t.ref), ["t1", "t2"]);
  eq("context: active anchors only", ctx.promptAnchors, [{ ref: "a1", title: "Gym" }]);
  eq("context: a task's one pending reminder is known", ctx.tasks.get("t1").pendingReminder, { id: uuid(600), remind_at: "2026-11-09T11:30:00.000Z" });
}

{
  fakeNow = NOW;
  const db = captureDb();
  const f = makeDeps({ db, ai: DINNER });
  await hook(f.deps, textUpdate("dinner at 8", { messageId: 11 }));

  eq("one AI call", f.aiCalls.length, 1);
  eq("the AI is told IST today and time", [f.aiCalls[0].ctx.today, f.aiCalls[0].ctx.weekday, f.aiCalls[0].ctx.clock], ["2026-11-05", "Thursday", "21:14"]);
  eq("nothing in tasks yet", db.tables.tasks.length, 4);
  eq("nothing in reminders yet", db.tables.reminders.length, 1);
  eq("one pending capture", db.tables.telegram_captures.map((c) => c.status), ["pending"]);
  const confirm = f.sent[0];
  ok("confirmation lists it with the day", confirm.text.includes("New task: <b>Dinner</b> — Fri, Nov 6 (tomorrow) · reminder 8:00 PM"));
  ok("… with the roll-over note", confirm.text.includes("8:00 PM today has passed, so I set it for tomorrow."));
  const capId = db.tables.telegram_captures[0].id;
  eq("[Save] [Cancel] carry only the capture id", confirm.keyboard, [[{ text: "Save", callback_data: "c:s:" + capId }, { text: "Cancel", callback_data: "c:x:" + capId }]]);
  eq("the confirmation's message id is stored", db.tables.telegram_captures[0].reply_message_id, 5001);

  await hook(f.deps, textUpdate("dinner at 8", { messageId: 11 }));
  eq("Telegram redelivers the same message → no second AI call", f.aiCalls.length, 1);
  eq("… no second capture", db.tables.telegram_captures.length, 1);
  eq("… no second confirmation", f.sent.length, 1);

  await hook(f.deps, callbackUpdate("c:s:" + capId));
  const newTasks = db.tables.tasks.filter((t) => t.title === "Dinner");
  eq("Save → one task, due tomorrow at noon IST", newTasks.map((t) => [t.user_id, t.due_date, t.status]), [[OWNER, "2026-11-06T06:30:00.000Z", "todo"]]);
  const newRems = db.tables.reminders.filter((r) => r.title === "Dinner");
  eq(
    "Save → one reminder, 20:00 IST tomorrow, linked, pending for the push cron",
    newRems.map((r) => [r.user_id, r.remind_at, r.task_id, r.is_sent, r.delivery_status]),
    [[OWNER, "2026-11-06T14:30:00.000Z", newTasks[0].id, false, "pending"]]
  );
  eq("Save → capture saved", db.tables.telegram_captures[0].status, "saved");
  eq("Save → the spinner stops with no toast", f.answers.at(-1).text, undefined);
  ok("Save → message redrawn, buttons removed", f.edits.at(-1).text.startsWith("<b>Saved.</b>") && f.edits.at(-1).keyboard === null);

  await hook(f.deps, callbackUpdate("c:s:" + capId));
  eq("double tap → still one task", db.tables.tasks.filter((t) => t.title === "Dinner").length, 1);
  eq("double tap → still one reminder", db.tables.reminders.filter((r) => r.title === "Dinner").length, 1);
  ok("double tap → the message still reads Saved", f.edits.at(-1).text.startsWith("<b>Saved.</b>"));

  await hook(f.deps, callbackUpdate("c:x:" + capId));
  eq("Cancel after Save → still reads Saved, changes nothing", [f.edits.at(-1).text.startsWith("<b>Saved.</b>"), db.tables.telegram_captures[0].status], [true, "saved"]);
}

async function pendingCapture(db, ai, { now = NOW, messageId = 21 } = {}) {
  fakeNow = now;
  const f = makeDeps({ db, ai, now });
  await hook(f.deps, textUpdate("x", { messageId }));
  return { f, id: db.tables.telegram_captures.at(-1)?.id };
}

{
  const db = captureDb();
  const { id } = await pendingCapture(db, DINNER);
  await Promise.all([saveCapture(db, OWNER, id, NOW), saveCapture(db, OWNER, id, NOW)]);
  eq("two Saves at once → one task", db.tables.tasks.filter((t) => t.title === "Dinner").length, 1);
  eq("two Saves at once → one reminder", db.tables.reminders.filter((r) => r.title === "Dinner").length, 1);
}
{
  const db = captureDb();
  const { id } = await pendingCapture(db, DINNER);
  db.failOn("telegram_captures", "update", "network blip");
  let threw = false;
  try {
    await saveCapture(db, OWNER, id, NOW);
  } catch {
    threw = true;
  }
  ok("a Save that dies at the last step throws (the user gets 'Couldn't save that')", threw);
  eq("… the capture is still pending", db.tables.telegram_captures.at(-1).status, "pending");
  await saveCapture(db, OWNER, id, NOW);
  eq("retry → still one task", db.tables.tasks.filter((t) => t.title === "Dinner").length, 1);
  eq("retry → still one reminder", db.tables.reminders.filter((r) => r.title === "Dinner").length, 1);
  eq("retry → saved", db.tables.telegram_captures.at(-1).status, "saved");
}
{
  const db = captureDb();
  const { id } = await pendingCapture(db, DINNER);
  const out = await cancelCapture(db, OWNER, id, NOW);
  eq("Cancel → cancelled", [out.kind, db.tables.telegram_captures.at(-1).status], ["cancelled", "cancelled"]);
  const again = await saveCapture(db, OWNER, id, NOW);
  eq("Save after Cancel → nothing written", [again.kind, again.status, db.tables.tasks.length, db.tables.reminders.length], ["already", "cancelled", 4, 1]);
}
{
  const db = captureDb();
  const { id } = await pendingCapture(db, DINNER);
  const late = Date.parse("2026-11-06T14:29:30Z"); // 30 s before the reminder
  const out = await saveCapture(db, OWNER, id, late);
  eq("Save after the reminder time → the task is saved", db.tables.tasks.filter((t) => t.title === "Dinner").length, 1);
  eq("… but no reminder in the past", db.tables.reminders.filter((r) => r.title === "Dinner").length, 0);
  ok("… and it says so", out.notes[0]?.includes("had passed by the time you tapped Save"));
}
{
  const db = captureDb();
  const { id } = await pendingCapture(db, DINNER);
  const out = await saveCapture(db, OWNER, id, NOW + 25 * 3600_000);
  eq("Save a day later → expired, nothing written", [out.kind, db.tables.tasks.length], ["expired", 4]);
}
{
  const db = captureDb();
  const at10 = Date.parse("2026-11-05T04:30:00Z");
  const { id } = await pendingCapture(db, () => [item({ title: "Landlord", match: "t1", time: "10:00" })], { now: at10 });
  await saveCapture(db, OWNER, id, at10);
  eq("update: the task's ONE pending reminder is moved (same row)", db.tables.reminders.map((r) => [r.id, r.remind_at]), [[uuid(600), "2026-11-06T04:30:00.000Z"]]);
  eq("update: the overdue task is re-dated", db.tables.tasks.find((t) => t.id === T_LEFT).due_date, "2026-11-06T06:30:00.000Z");
}
{
  const db = captureDb();
  const at10 = Date.parse("2026-11-05T04:30:00Z");
  const { id } = await pendingCapture(db, () => [item({ title: "Landlord", match: "t1", time: "10:00" })], { now: at10 });
  db.tables.reminders[0].is_sent = true; // it fired between reading and Save
  await saveCapture(db, OWNER, id, at10);
  eq("update: if that reminder fired meanwhile, a new one is added", db.tables.reminders.length, 2);
  eq("… the fired one is left alone", db.tables.reminders[0].remind_at, "2026-11-09T11:30:00.000Z");
}
{
  const db = captureDb();
  const at10 = Date.parse("2026-11-05T04:30:00Z");
  const { id } = await pendingCapture(db, () => [item({ title: "Gym", match: "a1", time: "19:00" })], { now: at10 });
  await saveCapture(db, OWNER, id, at10);
  const gymRem = db.tables.reminders.filter((r) => r.title === "Gym");
  eq("(b) Save → a reminder linked to nothing", gymRem.map((r) => [r.task_id, r.remind_at]), [[null, "2026-11-05T13:30:00.000Z"]]);
  eq("(b) … no task created", db.tables.tasks.length, 4);
}
{
  const db = captureDb();
  const { f } = await pendingCapture(db, () => [], { messageId: 31 });
  eq("(d) 'lol ok' → the inviting reply, no row", [f.sent.map((s) => s.text), db.tables.telegram_captures.length], [[NOTHING_TO_SAVE], 0]);
}
{
  const db = captureDb();
  const { f } = await pendingCapture(db, () => [item({ title: "Dentist", match: "t2" })], { messageId: 32 });
  ok("only 'already on your list' → shown without buttons, no row", !f.sent[0].keyboard && db.tables.telegram_captures.length === 0);
}
{
  const db = captureDb();
  const { f } = await pendingCapture(db, () => { throw new Error("groq 503"); }, { messageId: 33 });
  eq("AI fails → honest reply, nothing stored", [f.sent.map((s) => s.text), db.tables.telegram_captures.length], [[messages.COULDNT_READ], 0]);
}
{
  const db = captureDb();
  const f = makeDeps({ db, ai: DINNER, allow: () => false });
  await hook(f.deps, textUpdate("dinner at 8", { messageId: 34 }));
  eq("rate-limited → no AI call, honest reply", [f.aiCalls.length, f.sent.map((s) => s.text)], [0, [messages.AI_BUSY]]);
}
{
  const db = captureDb();
  const at0020 = Date.parse("2026-11-05T18:50:00Z");
  const f = makeDeps({ db, ai: () => [], now: at0020 });
  await hook(f.deps, textUpdate("call mom tomorrow", { messageId: 35 }));
  eq("near midnight: at 00:20 IST the AI is told it's Friday the 6th", [f.aiCalls[0].ctx.today, f.aiCalls[0].ctx.weekday, f.aiCalls[0].ctx.clock], ["2026-11-06", "Friday", "00:20"]);
}
{
  const db = captureDb();
  const f = makeDeps({ db, ai: DINNER });
  await hook(f.deps, textUpdate("x".repeat(2001), { messageId: 36 }));
  eq("over 2,000 characters → asks for shorter pieces, no AI call", [f.aiCalls.length, f.sent.map((s) => s.text)], [0, [messages.TOO_LONG]]);
}

// ═══════════════════════════════════════════════════════════════════════════
section("a tap is answered FIRST, before any database work");

for (const [label, data] of [
  ["Looks good", "p:a:" + P],
  ["Move", "p:m:" + I_TODAY],
  ["Drop", "p:d:" + I_TODAY],
]) {
  const db = planDb();
  const f = makeDeps({ db });
  let queriesAtAck = null;
  const answer = f.deps.telegram.answerCallbackQuery;
  f.deps.telegram.answerCallbackQuery = async (id, text) => {
    queriesAtAck = db.calls;
    return answer(id, text);
  };
  await hook(f.deps, callbackUpdate(data));
  eq(`${label}: no query had run when it was answered`, queriesAtAck, 0);
  ok(`${label}: the work still ran after it`, db.calls > 0);
  eq(`${label}: the message was still redrawn`, f.edits.length, 1);
}

for (const [label, make] of [
  [
    "Save",
    async (db) => {
      const { f, id } = await pendingCapture(db, DINNER);
      return { f, data: "c:s:" + id };
    },
  ],
  [
    "Cancel",
    async (db) => {
      const { f, id } = await pendingCapture(db, DINNER);
      return { f, data: "c:x:" + id };
    },
  ],
]) {
  const db = captureDb();
  const { f, data } = await make(db);
  let queriesAtAck = null;
  let textAtAck = "unset";
  const queriesBefore = db.calls;
  f.deps.telegram.answerCallbackQuery = async (_id, text) => {
    queriesAtAck = db.calls - queriesBefore;
    textAtAck = text;
  };
  await hook(f.deps, callbackUpdate(data));
  eq(`${label}: no query had run when it was answered`, queriesAtAck, 0);
  eq(`${label}: answered with no text, because the outcome isn't known yet`, textAtAck, undefined);
  ok(`${label}: the redraw says what happened`, f.edits.length === 1);
}

{
  // A failed answer must never cost the tap its work.
  const db = planDb();
  const f = botDeps(db);
  f.deps.telegram.answerCallbackQuery = async () => {
    throw new TelegramApiError("answerCallbackQuery", null, "request failed (TimeoutError)");
  };
  const logged = await captureErrors(() => hook(f.deps, callbackUpdate("p:m:" + I_TODAY)));
  eq("the answer fails → the move still lands", db.tables.daily_plan_items.find((i) => i.id === I_TODAY).status, "moved");
  eq("… the message is still redrawn", f.edits.length, 1);
  ok("… the failure is logged", logged.some((l) => l.includes("answerCallbackQuery") && l.includes("TimeoutError")));
  eq("… and the chat is not told anything false", f.sent, []);
}

{
  const db = planDb();
  const f = botDeps(db);
  f.deps.telegram.answerCallbackQuery = async () => {
    throw new TelegramApiError(
      "answerCallbackQuery",
      400,
      "Bad Request: query is too old and response timeout expired or query ID is invalid"
    );
  };
  const logged = await captureErrors(() => hook(f.deps, callbackUpdate("p:m:" + I_TODAY)));
  eq("'query is too old' (a repeat delivery) → the work still runs", db.tables.daily_plan_items.find((i) => i.id === I_TODAY).status, "moved");
  eq("… and it is not reported as a failure", logged, []);
  eq("… to anyone", f.sent, []);
}

// ═══════════════════════════════════════════════════════════════════════════
section("a failure after the answer is told to the chat");

{
  const db = planDb();
  const f = botDeps(db);
  db.failOn("daily_plan_items", "update", "network blip");
  const logged = await captureErrors(() => hook(f.deps, callbackUpdate("p:m:" + I_TODAY)));
  eq("the write fails → 'Couldn't save that'", f.sent.map((s) => s.text), ["Couldn't save that — try again."]);
  eq("… to the chat the button is in", f.sent[0].chatId, CHAT);
  eq("… the message is not redrawn", f.edits, []);
  eq("… the item is still planned", db.tables.daily_plan_items.find((i) => i.id === I_TODAY).status, "planned");
  ok("… and the reason is logged", logged.some((l) => l.includes("network blip")));

  const retry = botDeps(db);
  await hook(retry.deps, callbackUpdate("p:m:" + I_TODAY));
  eq("trying again works", db.tables.daily_plan_items.find((i) => i.id === I_TODAY).status, "moved");
  eq("… with nothing further said", retry.sent, []);
}

{
  // Through the real client, so the "not modified" rule itself is what's tested.
  const realTelegram = (edit) =>
    createTelegramApi("test-token", async (url) => {
      const method = url.split("/").pop();
      if (method === "editMessageText") return Response.json(edit);
      if (method === "sendMessage") throw new Error("nothing should be sent");
      return Response.json({ ok: true, result: true });
    });

  const db = planDb();
  const f = botDeps(db);
  f.deps.telegram = realTelegram({
    ok: false,
    error_code: 400,
    description: "Bad Request: message is not modified: specified new message content and reply markup are exactly the same",
  });
  const logged = await captureErrors(() => hook(f.deps, callbackUpdate("p:m:" + I_TODAY)));
  eq("'message is not modified' → silent in the log", logged, []);
  eq("… the move stands", db.tables.daily_plan_items.find((i) => i.id === I_TODAY).status, "moved");

  const g = botDeps(planDb());
  const sent = [];
  g.deps.telegram = {
    ...realTelegram({ ok: false, error_code: 400, description: "Bad Request: message to edit not found" }),
    sendMessage: async (_c, text) => {
      sent.push(text);
      return { message_id: 1 };
    },
  };
  const otherLogged = await captureErrors(() => hook(g.deps, callbackUpdate("p:m:" + I_TODAY)));
  eq("any other edit failure → the honest sentence", sent, ["Saved, but I couldn't update this message."]);
  ok("… with Telegram's reason in the log", otherLogged.some((l) => l.includes("message to edit not found")));

  // The token is in every Bot API URL, so no failure may ever repeat one.
  const secretish = createTelegramApi("SECRET-TOKEN-VALUE", async () => {
    throw new TypeError("fetch failed for https://api.telegram.org/botSECRET-TOKEN-VALUE/editMessageText");
  });
  let message = "";
  try {
    await secretish.editMessageText(CHAT, 1, "x");
  } catch (err) {
    message = err.message;
  }
  ok("a network failure's message never carries the token", message && !message.includes("SECRET-TOKEN-VALUE"), message);
}

{
  const db = planDb();
  const f = makeDeps({
    db,
    plan: { applyEdit: async () => ({ status: 500, body: { data: null, error: "boom" } }), readView: emptyView },
  });
  await captureErrors(() => hook(f.deps, callbackUpdate("p:a:" + P)));
  eq("a failed accept → 'Couldn't save that'", f.sent.map((s) => s.text), [messages.COULDNT_SAVE]);

  const gone = makeDeps({ db });
  await hook(gone.deps, callbackUpdate("p:a:" + uuid(999)));
  eq("a plan that no longer exists → says so", gone.sent.map((s) => s.text), [messages.PLAN_GONE]);
  eq("… after the optimistic toast", gone.answers.map((a) => a.text), ["Plan accepted"]);
}

{
  // Capture: the toast can't carry these any more, and each says what is true.
  const db = captureDb();
  const f = makeDeps({ db });
  await hook(f.deps, callbackUpdate("c:s:" + uuid(888)));
  eq("Save on a capture that's gone → the chat is told", f.sent.map((s) => s.text), [messages.CAPTURE_GONE]);
  const c = makeDeps({ db });
  await hook(c.deps, callbackUpdate("c:x:" + uuid(888)));
  eq("Cancel on a capture that's gone → the chat is told", c.sent.map((s) => s.text), [messages.CAPTURE_GONE]);

  const failDb = captureDb();
  const { id: failId } = await pendingCapture(failDb, DINNER);
  failDb.failOn("telegram_captures", "update", "network blip");
  const s = makeDeps({ db: failDb });
  await captureErrors(() => hook(s.deps, callbackUpdate("c:s:" + failId)));
  eq("a Save that fails → 'Couldn't save that'", s.sent.map((m) => m.text), [messages.COULDNT_SAVE]);
  eq("… and it stays pending, so trying again works", failDb.tables.telegram_captures.at(-1).status, "pending");

  const cancelDb = captureDb();
  const { id: cancelId } = await pendingCapture(cancelDb, DINNER);
  cancelDb.failOn("telegram_captures", "update", "network blip");
  const x = makeDeps({ db: cancelDb });
  await captureErrors(() => hook(x.deps, callbackUpdate("c:x:" + cancelId)));
  eq("a Cancel that fails → doesn't claim anything about saving", x.sent.map((m) => m.text), [messages.COULDNT_CANCEL]);

  for (const [label, data, expected, after] of [
    ["Save", "c:s:", messages.REDRAW_FAILED, "saved"],
    ["Cancel", "c:x:", messages.CANCELLED_REDRAW_FAILED, "cancelled"],
  ]) {
    const rDb = captureDb();
    const { id } = await pendingCapture(rDb, DINNER);
    const r = makeDeps({ db: rDb });
    r.deps.telegram.editMessageText = async () => {
      throw new Error("Telegram editMessageText failed (400): message to edit not found");
    };
    await captureErrors(() => hook(r.deps, callbackUpdate(data + id)));
    eq(`${label} lands but the redraw fails → says exactly that`, [r.sent.at(-1).text, rDb.tables.telegram_captures.at(-1).status], [expected, after]);
  }

  const oldDb = captureDb();
  const { id: oldId } = await pendingCapture(oldDb, DINNER);
  const o = makeDeps({ db: oldDb, now: NOW + 25 * 3600_000 });
  await hook(o.deps, callbackUpdate("c:s:" + oldId));
  ok("Save on an old capture → the message says it's too old", o.edits.at(-1).text.includes("more than a day old"));
  eq("… and nothing else needs saying", o.sent, []);
  o.deps.telegram.editMessageText = async () => {
    throw new Error("Telegram editMessageText failed (400): message to edit not found");
  };
  await captureErrors(() => hook(o.deps, callbackUpdate("c:s:" + oldId)));
  eq("… unless that redraw fails too", o.sent.map((m) => m.text), [messages.EXPIRED_REDRAW_FAILED]);
}

// ═══════════════════════════════════════════════════════════════════════════
section("the same tap delivered twice cannot apply twice");

for (const [label, data, itemId, itemStatus] of [
  ["Move", "p:m:" + I_TODAY, I_TODAY, "moved"],
  ["Drop of a leftover", "p:d:" + I_LEFT, I_LEFT, "dropped"],
  ["Drop of an anchor", "p:d:" + I_ANCHOR, I_ANCHOR, "skipped"],
]) {
  const db = planDb();
  const first = botDeps(db, NOW);
  const second = botDeps(db, NOW + 1000);
  await Promise.all([hook(first.deps, callbackUpdate(data)), hook(second.deps, callbackUpdate(data))]);

  const item = db.tables.daily_plan_items.find((i) => i.id === itemId);
  const itemWrites = db.log.filter((l) => l.table === "daily_plan_items" && l.op === "update");
  eq(`${label} at the same moment: both deliveries reached the write`, itemWrites.length, 2);
  eq(`${label}: only one matched the row`, itemWrites.filter((l) => l.ids.length > 0).length, 1);
  eq(`${label}: the row reads as one tap`, item.status, itemStatus);
  eq(`${label}: the first delivery's time stands`, item.status_changed_at, new Date(NOW).toISOString());
  eq(`${label}: both were answered`, first.answers.length + second.answers.length, 2);
  eq(`${label}: neither reported a failure`, first.sent.length + second.sent.length, 0);
}

{
  const db = planDb();
  const first = botDeps(db, NOW);
  const second = botDeps(db, NOW + 1000);
  await Promise.all([hook(first.deps, callbackUpdate("p:a:" + P)), hook(second.deps, callbackUpdate("p:a:" + P))]);
  eq("Looks good at the same moment: the first accept stands", db.tables.daily_plans.find((p) => p.id === P).accepted_at, new Date(NOW).toISOString());
}

{
  const db = planDb();
  const f = botDeps(db);
  await hook(f.deps, callbackUpdate("p:m:" + I_TODAY));
  const task = db.tables.tasks.find((t) => t.id === T_TODAY).due_date;
  const writes = db.log.length;
  const redelivered = botDeps(db, NOW + 60_000);
  await hook(redelivered.deps, callbackUpdate("p:m:" + I_TODAY));
  eq("redelivered later: no write at all", db.log.length, writes);
  eq("… the task's date is untouched", db.tables.tasks.find((t) => t.id === T_TODAY).due_date, task);
  eq("… and the message is redrawn the same", redelivered.edits[0].text, f.edits[0].text);
}

{
  const db = captureDb();
  const { id } = await pendingCapture(db, DINNER);
  const a = makeDeps({ db });
  const b = makeDeps({ db });
  await Promise.all([hook(a.deps, callbackUpdate("c:s:" + id)), hook(b.deps, callbackUpdate("c:s:" + id))]);
  eq("Save delivered twice at once → one task", db.tables.tasks.filter((t) => t.title === "Dinner").length, 1);
  eq("… one reminder", db.tables.reminders.filter((r) => r.title === "Dinner").length, 1);
}

// ═══════════════════════════════════════════════════════════════════════════
section("the redraw's read, and what the app still receives");

{
  const db = planDb();
  let started = 0;
  const counting = { ...db, from: (t) => { started += 1; return db.from(t); } };
  const reading = readDailyPlanView(counting, OWNER, P);
  eq("the plan and its items are asked for together", started, 2);
  const view = await reading;
  eq("the plan comes back", view.plan.id, P);
  eq("its items, in plan order", view.items.map((i) => i.id), [I_TODAY, I_LEFT, I_ANCHOR, I_MOVED]);
  eq("joined to the live task", view.items[1].task_due_date, "2026-11-03T06:30:00.000Z");
  eq("another user's plan id reads as nothing", await readDailyPlanView(db, OTHER, P), null);
  ok("a plan read never reaches the AI (its stubs throw)", view);
}

{
  const db = planDb();
  globalThis.__fakeDb = db;
  const res = await PATCH(
    new Request("http://prism.test/api/daily-plan", {
      method: "PATCH",
      body: JSON.stringify({ action: "move", item_id: I_TODAY }),
    })
  );
  eq("the app's PATCH response is unchanged by planId", Object.keys(res.body).sort(), ["data", "error"]);
  eq("… and so is its data", Object.keys(res.body.data).sort(), ["id", "moved_to", "status"]);
  eq("the edit tells the bot which plan to redraw", (await applyDailyPlanEdit(planDb(), OWNER, { action: "drop", item_id: I_ANCHOR }, new Date(NOW).toISOString())).planId, P);
  eq("… an accept too", (await applyDailyPlanEdit(planDb(), OWNER, { action: "accept", plan_id: P }, new Date(NOW).toISOString())).planId, P);
  eq("… and a repeat of one", (await applyDailyPlanEdit(planDb(), OWNER, { action: "drop", item_id: I_MOVED }, new Date(NOW).toISOString())).planId, P);
  eq("the redraw does not re-read the item's plan id", await (async () => {
    const d = planDb();
    const f = botDeps(d);
    const queries = [];
    const spy = { ...d, from: (t) => { queries.push(t); return d.from(t); } };
    f.deps.db = spy;
    await hook(f.deps, callbackUpdate("p:d:" + I_ANCHOR));
    return queries;
  })(), ["daily_plan_items", "daily_plan_items"]);
}

// ═══════════════════════════════════════════════════════════════════════════
section("[tg-timing]: one line per delivery, and nothing it must not say");

{
  const realLog = console.log;
  const lines = [];
  console.log = (line) => lines.push(String(line));
  const GATE = { webhookSecret: "SECRET-VALUE-XYZ", allowedChatId: String(CHAT) };
  const tapBody = JSON.stringify(callbackUpdate("p:d:" + I_ANCHOR));
  const privateText = JSON.stringify(textUpdate("PRIVATE-MESSAGE-TEXT"));
  const realFetch = globalThis.fetch;
  try {
    const t = createTapTimer(Date.now(), "ams1::abc-123");
    t.identify(tapBody, GATE.webhookSecret, GATE);
    await t.step("ack", async () => {})();
    await t.step("apply", async () => ({ status: 200 }), (o) => (o.status === 200 ? "ok" : `status${o.status}`))();
    await t.step("edit", async () => {
      throw new Error("Telegram editMessageText failed (400): query   is\ntoo old");
    })().catch(() => {});
    globalThis.fetch = async () => new Response(null, { status: 204 });
    await t.timedFetch("https://x.supabase.co/rest/v1/daily_plan_items?id=eq.SECRET-ROW", { method: "PATCH" });
    await t.timedFetch("https://x.supabase.co/rest/v1/tasks?id=eq.SECRET-ROW");
    t.finish();

    const refused = createTapTimer(Date.now(), null);
    refused.identify(tapBody, "wrong", GATE);
    refused.finish();

    const garbage = createTapTimer(Date.now(), null);
    garbage.identify("not json", GATE.webhookSecret, GATE);
    garbage.finish();

    const text = createTapTimer(Date.now(), null);
    text.identify(privateText, GATE.webhookSecret, GATE);
    text.finish();

    const off = createTapTimer(Date.now(), null);
    off.note("env=missing");
    off.finish();
  } finally {
    console.log = realLog;
    globalThis.fetch = realFetch;
  }
  const all = lines.join("\n");
  const [tap, refusedLine, garbageLine, textLine, offLine] = lines;
  eq("one line per delivery", lines.length, 5);
  ok("every line is tagged", lines.every((l) => l.startsWith("[tg-timing] ")));
  ok("no line spans two", lines.every((l) => !l.includes("\n")));
  ok("the absolute time, to set against the tap", /at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/.test(tap), tap);
  ok("who: update, query and button", tap.includes(`u=9077 q=cb-77 btn=p:d:${I_ANCHOR.slice(0, 8)}`), tap);
  ok("where it entered Vercel, not the request id", tap.includes("via=ams1 "), tap);
  ok("region and uptime are there", /region=\S+ via=\S+ cold=(true|false) uptime=\d+\.\ds/.test(tap), tap);
  ok("the steps, in the order they ran", /ack=\+\d+ms:ok apply=\+\d+ms:ok edit=\+\d+ms:FAILED\(.*\) db=2\/\d+ms total=\+\d+ms$/.test(tap), tap);
  ok("a failed step says why, on one line", tap.includes("query is too old"), tap);
  ok("a refused request is marked", refusedLine.includes("gate=refused") && !refusedLine.includes("u="), refusedLine);
  // The whole line, field by field: anything else on it came from the request.
  ok(
    "… and logs nothing from its body",
    /^\[tg-timing\] at=\S+ gate=refused region=\S+ via=unknown cold=false uptime=\S+ sha=\S+ db=0\/0ms total=\+\d+ms$/.test(refusedLine),
    refusedLine
  );
  ok(
    "a garbage body is marked, and not repeated",
    /^\[tg-timing\] at=\S+ gate=unparseable region=\S+ via=unknown cold=false uptime=\S+ sha=\S+ db=0\/0ms total=\+\d+ms$/.test(garbageLine),
    garbageLine
  );
  ok("a text message is labelled, not quoted", textLine.includes("kind=message"), textLine);
  ok("a misconfigured deployment says so", offLine.includes("env=missing"), offLine);
  ok("the secret is never logged", !all.includes("SECRET-VALUE-XYZ"));
  ok("message text is never logged", !all.includes("PRIVATE-MESSAGE-TEXT"));
  ok("query strings are never logged", !all.includes("SECRET-ROW"));
}

// ═══════════════════════════════════════════════════════════════════════════
section("tone");

const ALL_COPY = [
  ...Object.values(messages).filter((v) => typeof v === "string"),
  NOTHING_TO_SAVE,
  renderCaptureMessage([], "pending", NOW),
  renderCaptureMessage([], "expired", NOW),
  renderCaptureMessage([], "cancelled", NOW),
].join("\n");
ok("no 'you must / you should / you haven't / overdue'", !/you must|you should|you haven't|overdue/i.test(ALL_COPY));

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
