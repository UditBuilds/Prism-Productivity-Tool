/**
 * Unit checks for lib/srs/streak.ts — the one streak rule the Learn page and
 * GET /api/srs/analytics both call.
 *
 * It replaced two rules that disagreed: the Learn page ignored freezes, and the
 * analytics route spent them by WRITING on every GET, one per page load, so the
 * number depended on how often the app was opened. These checks pin the pure
 * rule, including the property the old one broke: same input, same answer.
 *
 * Calendar used throughout (all IST): 2026-10-05 is a MONDAY.
 *   Mon 09-28  Tue 09-29  Wed 09-30  Thu 10-01  Fri 10-02  Sat 10-03  Sun 10-04
 *   Mon 10-05  Tue 10-06  Wed 10-07  Thu 10-08
 *
 * Run:  node scripts/test-learning-streak.mjs
 *
 * Compiles with the project's own `typescript` devDependency — no test runner,
 * matching scripts/test-workout-analysis.mjs.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const out = mkdtempSync(path.join(tmpdir(), "prism-streak-"));
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

function compile() {
  // streak.ts imports "@/lib/date"; there is no tsconfig to resolve the alias
  // in the temp dir, so rewrite it to a sibling ESM specifier first.
  const srcs = ["lib/date.ts", "lib/srs/streak.ts"];
  for (const rel of srcs) {
    const text = readFileSync(path.join(root, rel), "utf8").replace(
      /["']@\/lib\/date["']/g,
      '"./date.js"'
    );
    writeFileSync(path.join(out, path.basename(rel)), text);
  }
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
  writeFileSync(
    path.join(out, "package.json"),
    JSON.stringify({ type: "module" })
  );
  return import(pathToFileURL(path.join(out, "streak.js")).href);
}

const { computeLearningStreak, FREEZES_PER_WEEK } = await compile();

/** An instant at an IST wall-clock time, as the ISO string srs_reviews holds. */
const at = (date, time = "12:00:00") =>
  new Date(Date.parse(`${date}T${time}+05:30`)).toISOString();
/** "Now" as epoch ms, at an IST wall-clock time. */
const now = (date, time = "15:00:00") => Date.parse(`${date}T${time}+05:30`);
const days = (...dates) => dates.map((d) => at(d));
const run = (reviews, nowMs) => computeLearningStreak(reviews, nowMs);

eq("FREEZES_PER_WEEK is 3", FREEZES_PER_WEEK, 3);

console.log("\nno reviews");
eq(
  "nothing reviewed → 0, all 3 freezes, nothing covered",
  run([], now("2026-10-07")),
  { streak: 0, freezesLeft: 3, coveredYesterday: null }
);
eq(
  "unparseable timestamps are ignored, not counted",
  run(["not a date", ""], now("2026-10-07")).streak,
  0
);

console.log("\nunbroken run");
const unbroken = days(
  "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
  "2026-10-05", "2026-10-06", "2026-10-07"
);
eq(
  "seven straight days including today → 7",
  run(unbroken, now("2026-10-07")),
  { streak: 7, freezesLeft: 3, coveredYesterday: null }
);
eq(
  "same run, nothing yet today → 6 (yesterday anchors, today isn't missed)",
  run(unbroken.slice(0, 6), now("2026-10-07")).streak,
  6
);
eq(
  "several reviews on one day count as one day",
  run(
    [...unbroken, at("2026-10-07", "08:00:00"), at("2026-10-07", "21:00:00")],
    now("2026-10-07", "22:00:00")
  ).streak,
  7
);

console.log("\nthe three cases from the investigation (today = Wed 10-07)");
eq(
  "A: reviewed -3, -2 and today, missed yesterday → 4",
  run(days("2026-10-04", "2026-10-05", "2026-10-07"), now("2026-10-07")),
  { streak: 4, freezesLeft: 2, coveredYesterday: "2026-10-06" }
);
// Mon 10-05 is itself a covered day: missed, and Sun 10-04 was active. It
// counts against this week's cap even though Tue 10-06 then broke the run —
// on Tuesday that freeze was what kept the streak alive.
eq(
  "B: reviewed -5..-3 and today, missed -2 and -1 → 1",
  run(
    days("2026-10-02", "2026-10-03", "2026-10-04", "2026-10-07"),
    now("2026-10-07")
  ),
  { streak: 1, freezesLeft: 2, coveredYesterday: null }
);
eq(
  "C: back after a month, reviewed only today → 1",
  run(days("2026-08-28", "2026-08-29", "2026-10-07"), now("2026-10-07")),
  { streak: 1, freezesLeft: 3, coveredYesterday: null }
);

console.log("\nmissed yesterday, no review yet today → stays alive all day");
const friToMon = days("2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05");
eq(
  "Wed 00:01, Tue missed, nothing yet today → 5, not 0",
  run(friToMon, now("2026-10-07", "00:01:00")),
  { streak: 5, freezesLeft: 2, coveredYesterday: "2026-10-06" }
);
eq(
  "Wed 23:59, still nothing today → still 5",
  run(friToMon, now("2026-10-07", "23:59:00")).streak,
  5
);
eq(
  "Wed after the first review → 6 (it goes up, it never dipped)",
  run(
    [...friToMon, at("2026-10-07", "10:00:00")],
    now("2026-10-07", "10:05:00")
  ).streak,
  6
);

console.log("\ntwo missed days in a row → breaks");
eq(
  "Thu, Tue and Wed both missed, nothing yet today → 0",
  run(friToMon, now("2026-10-08", "09:00:00")),
  { streak: 0, freezesLeft: 2, coveredYesterday: null }
);
eq(
  "Thu after a review → 1 (a covered day never covers the day after it)",
  run(
    [...friToMon, at("2026-10-08", "10:00:00")],
    now("2026-10-08", "10:05:00")
  ).streak,
  1
);

console.log("\nmore gaps in one week than the cap allows");
// Week Mon 09-28 .. Sun 10-04 alternates missed/active starting with a missed
// Monday, so it has FOUR candidate days: 09-28, 09-30, 10-02, 10-04. The first
// three in date order are covered; the fourth (Sunday) is refused.
const alternating = days(
  "2026-09-26", "2026-09-27", // Sat, Sun of the week before
  "2026-09-29", "2026-10-01", "2026-10-03" // Tue, Thu, Sat
);
eq(
  "Sun 10-04 (still today, so not missed): 3 gaps covered → 8, 0 left",
  run(alternating, now("2026-10-04")),
  { streak: 8, freezesLeft: 0, coveredYesterday: null }
);
eq(
  "Mon 10-05 reviewed: the 4th gap (Sun) is refused → 1",
  run([...alternating, at("2026-10-05")], now("2026-10-05")),
  { streak: 1, freezesLeft: 3, coveredYesterday: null }
);
eq(
  "Mon 10-05, nothing yet: yesterday is not covered, so the streak is 0",
  run(alternating, now("2026-10-05", "09:00:00")).streak,
  0
);

console.log("\nIST midnight (= 18:30 UTC)");
eq(
  "23:59:59 IST and 00:00:00 IST are two different days → 2",
  run(
    ["2026-10-05T18:29:59.000Z", "2026-10-05T18:30:00.000Z"],
    Date.parse("2026-10-05T18:31:00.000Z")
  ).streak,
  2
);
eq(
  "only the 23:59:59 review, checked at 00:01 IST → 1 (yesterday anchors)",
  run(["2026-10-05T18:29:59.000Z"], Date.parse("2026-10-05T18:31:00.000Z"))
    .streak,
  1
);
eq(
  "only the 00:00:00 review, checked at 00:01 → 1, counted as TODAY",
  run(["2026-10-05T18:30:00.000Z"], Date.parse("2026-10-05T18:31:00.000Z")),
  { streak: 1, freezesLeft: 3, coveredYesterday: null }
);
eq(
  "01:30 IST on 10-06 is UTC 10-05 — bucketed by IST, so 10-05 is the gap",
  run(
    [at("2026-10-04"), "2026-10-05T20:00:00.000Z"],
    now("2026-10-06")
  ),
  { streak: 3, freezesLeft: 2, coveredYesterday: "2026-10-05" }
);
eq(
  "one review on 10-05; at 23:59 on 10-06 the gap is not yet missed → 1",
  run([at("2026-10-05")], now("2026-10-06", "23:59:59")),
  { streak: 1, freezesLeft: 3, coveredYesterday: null }
);
eq(
  "…and one minute past midnight it is, and a freeze covers it → 2",
  run([at("2026-10-05")], now("2026-10-07", "00:00:30")),
  { streak: 2, freezesLeft: 2, coveredYesterday: "2026-10-06" }
);

console.log("\nSunday → Monday rollover");
const thuToSat = days("2026-10-01", "2026-10-02", "2026-10-03");
eq(
  "Mon 10-05, Sun missed: covered from LAST week, this week still has 3",
  run(thuToSat, now("2026-10-05", "10:00:00")),
  { streak: 4, freezesLeft: 3, coveredYesterday: "2026-10-04" }
);
eq(
  "Mon 10-05 after a review → 5",
  run([...thuToSat, at("2026-10-05", "11:00:00")], now("2026-10-05", "11:05:00"))
    .streak,
  5
);
// The alternating week used all 3 of ITS freezes; with Sunday active and
// Monday missed instead, Monday's gap draws on the NEW week's allowance.
const fullWeekThenMondayGap = days(
  "2026-09-26", "2026-09-27", "2026-09-29", "2026-10-01", "2026-10-03",
  "2026-10-04", // Sun active this time
  "2026-10-06" // Tue (today)
);
eq(
  "an exhausted week does not block next Monday's freeze → 11, 2 left",
  run(fullWeekThenMondayGap, now("2026-10-06")),
  { streak: 11, freezesLeft: 2, coveredYesterday: "2026-10-05" }
);

console.log("\nsame input, same answer");
const caseA = days("2026-10-04", "2026-10-05", "2026-10-07");
const caseANow = now("2026-10-07");
const first = JSON.stringify(run(caseA, caseANow));
const repeats = Array.from({ length: 10 }, () =>
  JSON.stringify(run(caseA, caseANow))
);
eq(
  "case A called 10 more times gives the identical result every time",
  repeats.every((r) => r === first),
  true
);
eq("…and that result is still streak 4", JSON.parse(first).streak, 4);
run(days("2026-10-02", "2026-10-03", "2026-10-04", "2026-10-07"), caseANow);
eq(
  "computing another user's streak in between changes nothing",
  JSON.stringify(run(caseA, caseANow)),
  first
);
eq(
  "review order does not matter",
  JSON.stringify(run([...caseA].reverse(), caseANow)),
  first
);
const frozenInput = Object.freeze([...caseA]);
eq(
  "the input array is not mutated (a frozen array is accepted)",
  run(frozenInput, caseANow).streak,
  4
);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
