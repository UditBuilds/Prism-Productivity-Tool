/**
 * Unit checks for lib/daily-plan/compose.ts — what goes into today's plan, the
 * fixed fallback order, and the checks an AI order must pass.
 *
 * The plan's date is an ARGUMENT everywhere in compose.ts, so the Monday vs
 * Tuesday behaviour is pinned here without mocking a clock.
 *
 * Calendar used throughout (IST): 2026-10-19 is a MONDAY.
 *   Thu 10-15  Fri 10-16  Sat 10-17  Sun 10-18  Mon 10-19  Tue 10-20
 *
 * Run:  node scripts/test-daily-plan.mjs
 *
 * Compiles with the project's own `typescript` devDependency — no test runner,
 * matching scripts/test-learning-streak.mjs.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const out = mkdtempSync(path.join(tmpdir(), "prism-daily-plan-"));
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
    console.log(
      "  FAIL  " + label + "\n        expected " + e + "\n        actual   " + a
    );
  }
}

async function compile() {
  // compose.ts and view.ts import "@/lib/date"; view.ts also imports three
  // unions from "@/types/database", which would drag in the whole schema type.
  // The aliases become sibling specifiers, and database.ts is just those three
  // lines, lifted from the real file so they cannot drift.
  const srcs = ["lib/date.ts", "lib/daily-plan/compose.ts", "lib/daily-plan/view.ts"];
  for (const rel of srcs) {
    const text = readFileSync(path.join(root, rel), "utf8")
      .replace(/["']@\/lib\/date["']/g, '"./date.js"')
      .replace(/["']@\/types\/database["']/g, '"./database.js"');
    writeFileSync(path.join(out, path.basename(rel)), text);
  }
  const unions = readFileSync(path.join(root, "types/database.ts"), "utf8")
    .split("\n")
    .filter((l) => /^export type DailyPlan(Source|ItemKind|ItemStatus) = /.test(l));
  if (unions.length !== 3) throw new Error("daily-plan unions not found in types/database.ts");
  writeFileSync(path.join(out, "database.ts"), unions.join("\n") + "\n");
  srcs.push("database.ts");
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules", "typescript", "bin", "tsc"),
      "--target", "ES2019",
      "--module", "ES2020",
      "--moduleResolution", "node",
      "--skipLibCheck",
      "--outDir", out,
      ...srcs.map((s) => path.join(out, path.basename(s))),
    ],
    { stdio: "inherit" }
  );
  writeFileSync(path.join(out, "package.json"), JSON.stringify({ type: "module" }));
  return {
    ...(await import(pathToFileURL(path.join(out, "compose.js")).href)),
    ...(await import(pathToFileURL(path.join(out, "view.js")).href)),
  };
}

const {
  addCivilDays,
  buildPlanCandidates,
  civilWeekday,
  cleanAiReason,
  fallbackOrder,
  fallbackReason,
  followsSatisfied,
  toPlanItemsPayload,
  validateAiOrder,
  DAY_CAP,
  isLeftover,
  planSections,
} = await compile();

// Udit's four anchors, as the seed SQL creates them.
const GYM = { id: "gym", title: "Gym", days_of_week: [1, 3, 5], position: 1, follows_anchor_id: null };
const POST = { id: "post", title: "Post on the gym Instagram page", days_of_week: [1, 3, 5], position: 2, follows_anchor_id: "gym" };
const JOBS = { id: "jobs", title: "3 job applications", days_of_week: [1, 2, 3, 4, 5], position: 3, follows_anchor_id: null };
const AI = { id: "ai", title: "1 hour of AI engineering work", days_of_week: [0, 1, 2, 3, 4, 5, 6], position: 4, follows_anchor_id: null };
const ANCHORS = [AI, JOBS, POST, GYM]; // deliberately out of order

const task = (id, title, due_date, priority = "medium") => ({ id, title, due_date, priority });
const TASKS = [
  task("overdue", "Cancel xbox pass", "2026-10-15T06:30:00+00:00"),
  task("today-noon", "Reply to recruiter", "2026-10-19T06:30:00+00:00", "high"),
  // A cron-spawned recurring instance: 00:00 UTC = 05:30 IST, same IST day.
  task("today-cron", "Groceries", "2026-10-19T00:00:00+00:00", "low"),
  task("tomorrow", "Dentist", "2026-10-20T06:30:00+00:00"),
  // 23:59:59 IST on Monday is still Monday; 00:00 IST Tuesday is not.
  task("mon-late", "Late Monday", "2026-10-19T18:29:59+00:00"),
  task("tue-midnight", "Tuesday midnight", "2026-10-19T18:30:00+00:00"),
];

const build = (planDate, opts = {}) =>
  buildPlanCandidates({
    planDate,
    anchors: opts.anchors ?? ANCHORS,
    carriedAnchorIds: opts.carried ?? [],
    tasks: opts.tasks ?? TASKS,
  });
const ids = (cands) => cands.map((c) => (c.kind === "anchor" ? c.anchorId : c.taskId));
const titlesInOrder = (order, cands) =>
  order.map((k) => cands.find((c) => c.key === k).title);

console.log("\ncivil date helpers");
eq("2026-10-19 is a Monday", civilWeekday("2026-10-19"), 1);
eq("2026-10-20 is a Tuesday", civilWeekday("2026-10-20"), 2);
eq("year rollover", addCivilDays("2026-12-31", 1), "2027-01-01");
eq("leap day", addCivilDays("2028-02-28", 1), "2028-02-29");

console.log("\nMonday plan");
const mon = build("2026-10-19");
eq(
  "anchors for Monday, in position order, then overdue + today tasks",
  ids(mon),
  ["gym", "post", "jobs", "ai", "overdue", "today-noon", "today-cron", "mon-late"]
);
eq("tomorrow's task is NOT in Monday's plan", ids(mon).includes("tomorrow"), false);
eq("00:00 IST Tuesday is NOT in Monday's plan", ids(mon).includes("tue-midnight"), false);
eq("cron-style 00:00 UTC task counts as today", ids(mon).includes("today-cron"), true);
eq(
  "overdue task carries its lateness in IST days",
  mon.find((c) => c.taskId === "overdue").overdueDays,
  4
);
eq(
  "the post follows the gym when both are present",
  mon.find((c) => c.anchorId === "post").followsAnchorId,
  "gym"
);

console.log("\nTuesday plan");
const tue = build("2026-10-20");
eq("no gym on Tuesday", ids(tue).includes("gym"), false);
eq("no Instagram post on Tuesday", ids(tue).includes("post"), false);
eq("job applications on Tuesday", ids(tue).includes("jobs"), true);
eq("AI work on Tuesday", ids(tue).includes("ai"), true);
eq(
  "Tuesday picks up Monday's open tasks as overdue, and its own",
  ids(tue).filter((id) => !["jobs", "ai"].includes(id)),
  ["overdue", "today-noon", "today-cron", "tomorrow", "mon-late", "tue-midnight"]
);

console.log("\nSunday plan");
eq("Sunday: only the every-day anchor", ids(build("2026-10-18", { tasks: [] })), ["ai"]);

console.log("\ncarried anchors (moved to tomorrow)");
const carriedTue = build("2026-10-20", { carried: ["gym"], tasks: [] });
eq("a gym moved from Monday appears on Tuesday", ids(carriedTue), ["gym", "jobs", "ai"]);
eq("…marked carried", carriedTue.find((c) => c.anchorId === "gym").carried, true);
eq(
  "…and the post does not follow a gym that is not there on Tuesday",
  carriedTue.some((c) => c.anchorId === "post"),
  false
);
const carriedDup = build("2026-10-20", { carried: ["jobs"], tasks: [] });
eq("an anchor both carried and scheduled appears once", ids(carriedDup), ["jobs", "ai"]);
eq("…and is not marked carried", carriedDup.find((c) => c.anchorId === "jobs").carried, false);

console.log("\nfallback order");
const monOrder = fallbackOrder(mon);
eq(
  "anchors (post right after gym), overdue oldest first, today by priority",
  titlesInOrder(monOrder, mon),
  [
    "Gym",
    "Post on the gym Instagram page",
    "3 job applications",
    "1 hour of AI engineering work",
    "Cancel xbox pass",
    "Reply to recruiter",
    "Late Monday",
    "Groceries",
  ]
);
const postFirst = build("2026-10-19", {
  anchors: [{ ...POST, position: 0 }, GYM, JOBS, AI],
  tasks: [],
});
eq(
  "a follower listed BEFORE its leader is still placed right after it",
  titlesInOrder(fallbackOrder(postFirst), postFirst),
  ["Gym", "Post on the gym Instagram page", "3 job applications", "1 hour of AI engineering work"]
);
eq("the fallback order satisfies its own follows rule", followsSatisfied(monOrder, mon), true);

console.log("\nfallback reason");
eq("anchors + overdue + today", fallbackReason(mon), "Your fixed items first, then 1 overdue task, then 3 due today.");
eq("anchors only", fallbackReason(build("2026-10-18", { tasks: [] })), "Your fixed items for today, in their usual order.");

console.log("\nvalidating an AI order");
const keys = mon.map((c) => c.key);
const keyOf = (id) => mon.find((c) => (c.kind === "anchor" ? c.anchorId : c.taskId) === id).key;
const aiOrder = ["overdue", "gym", "post", "jobs", "today-noon", "ai", "today-cron", "mon-late"].map(keyOf);
eq("a valid permutation that keeps gym→post is accepted", validateAiOrder(aiOrder, mon), aiOrder);
eq("not an array → rejected", validateAiOrder("a1,a2", mon), null);
eq("missing an item → rejected", validateAiOrder(keys.slice(1), mon), null);
eq("a duplicated item → rejected", validateAiOrder([...keys.slice(1), keys[1]], mon), null);
eq("an invented id → rejected", validateAiOrder([...keys.slice(1), "z9"], mon), null);
const split = ["gym", "jobs", "post", "ai", "overdue", "today-noon", "today-cron", "mon-late"].map(keyOf);
eq("the post NOT directly after the gym → rejected", validateAiOrder(split, mon), null);

console.log("\nvalidating an AI reason");
eq(
  "the OBSERVED reason (verbatim, Groq 2026-10-17) with Gym first → rejected",
  cleanAiReason("Start with the overdue task, then high priority, keeping the gym flow intact.", "Gym"),
  null
);
eq(
  "naming the first item only late in the sentence is not enough",
  cleanAiReason("Clear the small stuff, then the rest, and finally gym.", "Gym"),
  null
);
eq(
  "an hour of AI work named in the opening words → kept",
  cleanAiReason("Begin with an hour of AI engineering while fresh.", "1 hour of AI engineering work") !== null,
  true
);
eq(
  "a reason that opens with the first item → kept",
  cleanAiReason("Gym first while energy is fresh, then the quick overdue task.", "Gym"),
  "Gym first while energy is fresh, then the quick overdue task."
);
eq(
  "singular of a plural title word still counts",
  cleanAiReason("Start with one job application to get moving.", "3 job applications") !== null,
  true
);
eq("whitespace collapsed to one line", cleanAiReason("  Gym  first.\nThen the rest. ", "Gym"), "Gym first. Then the rest.");
eq("empty → rejected", cleanAiReason("   ", "Gym"), null);
eq("too long → rejected", cleanAiReason("Gym " + "x".repeat(200), "Gym"), null);
eq("not a string → rejected", cleanAiReason(42, "Gym"), null);

console.log("\nRPC payload");
const payload = toPlanItemsPayload(monOrder, mon);
eq("positions are 1..n in plan order", payload.map((p) => p.position), [1, 2, 3, 4, 5, 6, 7, 8]);
eq(
  "anchor rows carry only anchor_id, task rows only task_id",
  [payload[0], payload[4]].map((p) => [p.kind, p.anchor_id, p.task_id]),
  [["anchor", "gym", null], ["task", null, "overdue"]]
);

console.log("\nLeftovers and the day cap (view.ts) — plan for Tue 10-20");
const TUE = "2026-10-20";
const row = (id, over = {}) => ({
  id,
  position: 0,
  kind: "task",
  title: id,
  status: "planned",
  moved_to: null,
  task_id: "task-" + id,
  task_due_date: "2026-10-20T06:30:00+00:00",
  task_done: false,
  after_title: null,
  carried: false,
  gone: false,
  ...over,
});
const due = (iso) => row("x", { task_due_date: iso });

eq("due yesterday noon → leftover", isLeftover(due("2026-10-19T06:30:00+00:00"), TUE), true);
eq("due 3 days ago → leftover", isLeftover(due("2026-10-17T06:30:00+00:00"), TUE), true);
eq("due on the plan's day → not a leftover", isLeftover(due("2026-10-20T06:30:00+00:00"), TUE), false);
eq("cron instance 00:00 UTC (05:30 IST) on the plan's day → not a leftover", isLeftover(due("2026-10-20T00:00:00+00:00"), TUE), false);
eq("23:59:59 IST the day before → leftover", isLeftover(due("2026-10-19T18:29:59+00:00"), TUE), true);
eq("00:00 IST on the plan's day → not a leftover", isLeftover(due("2026-10-19T18:30:00+00:00"), TUE), false);
eq("an anchor is never a leftover", isLeftover(row("a", { kind: "anchor", task_id: null, task_due_date: null }), TUE), false);
eq("a task with no date (dropped leftover) → not a leftover", isLeftover(due(null), TUE), false);
eq("an unparseable date → not a leftover", isLeftover(due("not a date"), TUE), false);

// The verification seed: 3 leftovers + 6 for today + 1 anchor.
const seeded = [
  row("gym", { kind: "anchor", task_id: null, task_due_date: null }),
  row("l-yday-1", { task_due_date: "2026-10-19T06:30:00+00:00" }),
  row("t1"), row("t2"), row("t3"),
  row("l-3days", { task_due_date: "2026-10-17T06:30:00+00:00" }),
  row("t4"), row("t5"), row("t6"),
  row("l-yday-2", { task_due_date: "2026-10-19T06:30:00+00:00" }),
];
const s = planSections(seeded, TUE);
eq("leftovers keep the plan's order", s.leftovers.map((i) => i.id), ["l-yday-1", "l-3days", "l-yday-2"]);
eq("today keeps the plan's order, anchor included", s.today.map((i) => i.id), ["gym", "t1", "t2", "t3", "t4", "t5", "t6"]);
eq("'N for today' counts tasks only (the anchor is not one)", s.openTodayTasks, 6);
eq("cap count: 3 leftovers + 6 today = 9, anchor not counted", s.openTasks, 9);
eq("DAY_CAP is 5", DAY_CAP, 5);

const worked = seeded.map((i) =>
  i.id === "l-yday-1" ? { ...i, task_done: true }
  : i.id === "t1" ? { ...i, task_done: true }
  : i.id === "t2" ? { ...i, status: "moved", moved_to: "2026-10-21" }
  : i.id === "t3" ? { ...i, status: "dropped" }
  : i.id === "t4" ? { ...i, gone: true }
  : i
);
const w = planSections(worked, TUE);
eq("a done leftover stays in its group, struck through", w.leftovers.map((i) => i.id), ["l-yday-1", "l-3days", "l-yday-2"]);
eq("…but is not open: Move all and the header skip it", w.openLeftovers.map((i) => i.id), ["l-3days", "l-yday-2"]);
eq("moved, dropped and deleted rows leave today's list; done stays", w.today.map((i) => i.id), ["gym", "t1", "t5", "t6"]);
eq("done, moved, dropped and deleted tasks are not load", [w.openTodayTasks, w.openTasks], [2, 4]);

const allDone = seeded.map((i) => (i.id.startsWith("l-") ? { ...i, task_done: true } : i));
const d = planSections(allDone, TUE);
eq("every leftover done → the group closes", [d.leftovers.length, d.openLeftovers.length], [0, 0]);
eq("…and its done rows do not move down into today's list", d.today.some((i) => i.id.startsWith("l-")), false);

const atCap = planSections([row("a1"), row("a2"), row("a3"), row("a4"), row("a5")], TUE).openTasks;
const overCap = planSections([row("a1"), row("a2"), row("a3"), row("a4"), row("a5"), row("a6")], TUE).openTasks;
eq("5 open tasks is not over the cap, 6 is", [atCap > DAY_CAP, overCap > DAY_CAP], [false, true]);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
