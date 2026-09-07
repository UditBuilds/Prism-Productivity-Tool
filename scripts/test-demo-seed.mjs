/**
 * Does the demo seed actually make the progressive-overload view render?
 *
 * This is the one requirement in the demo-account work that can fail silently
 * and still look finished. WorkoutProgressPanel has two degraded shapes:
 *
 *   - no parsed sets at all  -> "Nothing logged yet"
 *   - sets, but no exercise logged on 2+ distinct IST days
 *                            -> every row is a bare baseline under
 *                               "No exercise logged twice yet"
 *
 * The second is the dangerous one: rows appear, numbers appear, and the
 * feature still reads as not-quite-working to anyone being shown the app. A
 * row count proves nothing about it — `comparableExercises` does.
 *
 * So this parses the workout rows OUT OF supabase/demo-seed.sql and runs the
 * real lib/workout-analysis.ts over them. Reading the SQL rather than
 * restating it is the whole point: a copy of the seed would keep passing after
 * someone edited the seed itself.
 *
 * The other thing it catches is body-part mapping. bodyPartForExercise is an
 * EXACT exerciseKey match against the static library, so a plausible-looking
 * invented name ("Bench", "Lat Pulldowns") silently lands in "Other" instead
 * of the group it trains — the live account already has that defect with
 * "Crunch" and "Lateral Raise Drop Set". Every seeded name must resolve.
 *
 * Run:  node scripts/test-demo-seed.mjs
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
const out = mkdtempSync(path.join(tmpdir(), "prism-demo-seed-"));
let failures = 0;
let checks = 0;

function ok(label, condition, detail) {
  checks++;
  if (condition) {
    console.log("  ok    " + label);
  } else {
    failures++;
    console.log("  FAIL  " + label + (detail ? "\n        " + detail : ""));
  }
}

function eq(label, actual, expected) {
  ok(
    label,
    JSON.stringify(actual) === JSON.stringify(expected),
    "expected " + JSON.stringify(expected) + "\n        actual   " + JSON.stringify(actual)
  );
}

function compile() {
  const srcs = [
    "types/database.ts",
    "lib/date.ts",
    "lib/workouts.ts",
    "lib/exercise-library.ts",
    "lib/workout-analysis.ts",
    "lib/markdown.ts",
    "lib/notes/revisit-summary.ts",
  ];
  for (const rel of srcs) {
    const text = readFileSync(path.join(root, rel), "utf8")
      .replace(/["']@\/types\/database["']/g, '"./database.js"')
      .replace(/["']@\/lib\/date["']/g, '"./date.js"')
      .replace(/["']@\/lib\/workouts["']/g, '"./workouts.js"')
      .replace(/["']@\/lib\/exercise-library["']/g, '"./exercise-library.js"')
      .replace(/["']@\/lib\/markdown["']/g, '"./markdown.js"');
    // Flattened into one temp dir, so lib/notes/revisit-summary.ts lands as
    // revisit-summary.ts beside markdown.ts — hence the rewrite above.
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
  return Promise.all([
    import(pathToFileURL(path.join(out, "workout-analysis.js")).href),
    import(pathToFileURL(path.join(out, "exercise-library.js")).href),
    import(pathToFileURL(path.join(out, "revisit-summary.js")).href),
  ]);
}

/**
 * Decode one SQL string literal as Postgres would.
 *
 * The seed writes note bodies as E'…\n…' escape strings, so the SQL source is
 * NOT the stored text: `\n` is two characters in the file and one in the
 * column. Measuring the file would overstate every length by the newline
 * count and quietly hide a note that is actually under the threshold.
 */
function decodeSqlEscapeString(literal) {
  return literal
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\")
    .replace(/''/g, "'");
}

// ---------------------------------------------------------------------------
// Parse the seed's workout rows straight out of the SQL.
// ---------------------------------------------------------------------------
const sql = readFileSync(path.join(root, "supabase", "demo-seed.sql"), "utf8");

const block = sql.slice(
  sql.indexOf("CREATE TEMP TABLE demo_seed_sets"),
  sql.indexOf(") AS v(days_ago")
);

if (block.length < 100) {
  console.error("could not find the demo_seed_sets VALUES block in demo-seed.sql");
  process.exit(1);
}

/** (days_ago, 'Exercise', ex_position, set_index, weight_kg, reps) */
const ROW = /\(\s*(\d+),\s*'([^']+)',\s*(\d+),\s*(\d+),\s*([\d.]+),\s*(\d+)\s*\)/g;

const seedRows = [];
for (const m of block.matchAll(ROW)) {
  seedRows.push({
    daysAgo: Number(m[1]),
    exercise: m[2],
    exPosition: Number(m[3]),
    setIndex: Number(m[4]),
    weightKg: Number(m[5]),
    reps: Number(m[6]),
  });
}

// The session-day list, parsed from the same file so the two cannot disagree.
const sessionBlock = sql.slice(
  sql.indexOf("INSERT INTO workout_sessions"),
  sql.indexOf("AS s(n, days_ago)")
);
const sessionDaysAgo = [...sessionBlock.matchAll(/\((\d+),\s*(\d+)\)/g)].map((m) =>
  Number(m[2])
);

// ---------------------------------------------------------------------------
// Rebuild the rows the way the SQL builds them.
//
// performed_at is `((d0 - days_ago) + time '18:30') AT TIME ZONE
// 'Asia/Kolkata'`, and 18:30 IST is 13:00 UTC exactly (IST is a fixed +05:30,
// no DST), plus the per-exercise and per-set offsets.
// ---------------------------------------------------------------------------
const DAY_MS = 86_400_000;

/** Today as an IST civil date, the same value d0 takes in the function. */
function istToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const today = istToday();
const [ty, tm, td] = today.split("-").map(Number);
const todayNoonUtcMs = Date.UTC(ty, tm - 1, td, 13, 0, 0);

const sets = seedRows.map((r, i) => ({
  id: "seed-" + i,
  user_id: "demo",
  capture_id: "cap-" + r.daysAgo + "-" + r.exPosition,
  raw_input: `${r.exercise} ${r.weightKg}kg x ${r.reps}`,
  performed_at: new Date(
    todayNoonUtcMs -
      r.daysAgo * DAY_MS +
      (r.exPosition - 1) * 14 * 60_000 +
      (r.setIndex - 1) * 3 * 60_000
  ).toISOString(),
  exercise: r.exercise,
  weight_kg: r.weightKg,
  reps: r.reps,
  set_index: r.setIndex,
  created_at: null,
  session_exercise_id: null,
}));

const [
  { analyseWorkoutSets },
  { bodyPartForExercise, UNCLASSIFIED_BODY_PART },
  { revisitPreview, summaryParagraph, SUMMARY_THRESHOLD_CHARS },
] = await compile();

const analysis = analyseWorkoutSets(sets, 180, today);

console.log(`\ndemo seed — parsed from supabase/demo-seed.sql (IST today ${today})`);
ok("seed block yields workout rows", sets.length > 0, `parsed ${sets.length}`);
eq("every row parsed (no unparsed sets)", analysis.unparsedSets, 0);
eq(
  "session days match the workout_sessions insert",
  analysis.sessionDays,
  new Set(sessionDaysAgo).size
);

console.log("\nprogressive overload — the requirement that can fail silently");
ok(
  "progressions render at all (not the 'Nothing logged yet' branch)",
  analysis.progressions.length > 0,
  `progressions=${analysis.progressions.length}`
);
ok(
  "comparableExercises > 0 — the 'No exercise logged twice yet' banner is NOT shown",
  analysis.comparableExercises > 0,
  `comparableExercises=${analysis.comparableExercises}`
);
ok(
  "a substantial majority of exercises are comparable, not just one",
  analysis.comparableExercises >= 5,
  `comparableExercises=${analysis.comparableExercises} of ${analysis.progressions.length}`
);

const withChange = analysis.progressions.filter((p) => p.change !== null);
ok(
  "every comparable row carries a delta chip",
  withChange.length === analysis.comparableExercises,
  `withChange=${withChange.length} comparable=${analysis.comparableExercises}`
);
ok(
  "deltas are measured on weight, not a reps/sets fallback",
  withChange.every((p) => p.change.basis === "weight"),
  withChange.map((p) => `${p.exercise}:${p.change.basis}`).join(", ")
);
ok(
  "progression is upward — a demo showing losses reads as a broken app",
  withChange.every((p) => p.change.direction === "up"),
  withChange.map((p) => `${p.exercise}:${p.change.direction}`).join(", ")
);

console.log("\nbody-part mapping — an invented name silently becomes 'Other'");
const unmapped = [...new Set(seedRows.map((r) => r.exercise))].filter(
  (name) => bodyPartForExercise(name) === null
);
eq("every seeded exercise resolves to a library group", unmapped, []);
ok(
  `no sets land in "${UNCLASSIFIED_BODY_PART}"`,
  !analysis.bodyParts.some((b) => b.bodyPart === UNCLASSIFIED_BODY_PART && b.sets > 0),
  JSON.stringify(
    analysis.bodyParts.filter((b) => b.bodyPart === UNCLASSIFIED_BODY_PART)
  )
);

console.log("\nlagging body parts — the analysis needs something to find");
const untrained = analysis.bodyParts.filter((b) => b.daysSince === null);
const stale = analysis.bodyParts.filter(
  (b) => b.daysSince !== null && b.daysSince >= 14
);
ok(
  "at least one group is never-trained (renders 'Nothing in the last 180 days')",
  untrained.length > 0,
  untrained.map((b) => b.bodyPart).join(", ")
);
ok(
  "at least one group is stale-but-dated (the other shape of the finding)",
  stale.length > 0,
  stale.map((b) => `${b.bodyPart}:${b.daysSince}d`).join(", ")
);
ok(
  "at least three groups ARE trained recently, so it is not just an empty app",
  analysis.bodyParts.filter((b) => b.daysSince !== null && b.daysSince <= 10)
    .length >= 3,
  analysis.bodyParts
    .filter((b) => b.daysSince !== null)
    .map((b) => `${b.bodyPart}:${b.daysSince}d`)
    .join(", ")
);

// ---------------------------------------------------------------------------
// The Revisit notes must be long enough that the AI-summary path actually runs.
//
// This is a silent failure, not a loud one. Under the threshold the widget
// still renders — it just renders the raw markdown and never reads `summary`,
// so the seeded summaries become dead columns and the demo hides the one
// feature the app is named for. The first version of this seed shipped three
// notes of 345, 514 and 347 characters and looked fine.
// ---------------------------------------------------------------------------
const notesBlock = sql.slice(
  sql.indexOf("INSERT INTO notes ("),
  sql.indexOf("INSERT INTO reminders (")
);

/** title, E'content', ARRAY[...], 'revisit', E'summary' */
const REVISIT =
  /'([^']+)',\s*E'([^']*)',\s*ARRAY\[[^\]]*\],\s*'revisit',\s*E'([^']*)',/g;

const revisitNotes = [...notesBlock.matchAll(REVISIT)].map((m) => ({
  title: m[1],
  content: decodeSqlEscapeString(m[2]),
  summary: decodeSqlEscapeString(m[3]),
}));

console.log(
  `\nrevisit notes — threshold is ${SUMMARY_THRESHOLD_CHARS} (strict >), from lib/notes/revisit-summary.ts`
);
eq("three revisit notes parsed from the seed", revisitNotes.length, 3);

for (const note of revisitNotes) {
  const len = note.content.length;
  ok(
    `"${note.title}" content is ${len} chars — over ${SUMMARY_THRESHOLD_CHARS}`,
    len > SUMMARY_THRESHOLD_CHARS,
    `needs > ${SUMMARY_THRESHOLD_CHARS}, has ${len}`
  );
  ok(
    `"${note.title}" clears it with margin, not by a hair`,
    len >= SUMMARY_THRESHOLD_CHARS + 100,
    `only ${len - SUMMARY_THRESHOLD_CHARS} over the threshold`
  );
  // The decisive one: the real render decision, not a length proxy.
  const preview = revisitPreview(note.content, note.summary);
  ok(
    `"${note.title}" renders mode "summary", not raw markdown`,
    preview.mode === "summary",
    `revisitPreview returned mode "${preview.mode}"`
  );
  ok(
    `"${note.title}" summary survives flattening to one paragraph`,
    preview.mode === "summary" &&
      summaryParagraph(preview.markdown).length > 80 &&
      !summaryParagraph(preview.markdown).includes("\n"),
    preview.mode === "summary"
      ? JSON.stringify(summaryParagraph(preview.markdown).slice(0, 80))
      : "(not in summary mode)"
  );
}

console.log("\n--- what a visitor would see ---");
for (const note of revisitNotes) {
  const preview = revisitPreview(note.content, note.summary);
  console.log(
    `  ${note.content.length} chars -> ${preview.mode}  ${note.title}`
  );
  if (preview.mode === "summary") {
    console.log(`    "${summaryParagraph(preview.markdown)}"`);
  }
}

console.log(
  `  ${analysis.totalSets} sets, ${analysis.sessionDays} session days, ` +
    `${analysis.firstSessionDate} → ${analysis.lastSessionDate}`
);
for (const p of analysis.progressions) {
  const change = p.change
    ? `${p.change.direction === "up" ? "+" : ""}${p.change.delta} ${p.change.basis}`
    : "baseline";
  console.log(
    `  ${(p.bodyPart ?? "?").padEnd(10)} ${p.exercise.padEnd(24)} ` +
      `${p.sessions.length} sessions  best ${p.bestWeightKg}kg  ${change}`
  );
}
for (const b of analysis.bodyParts) {
  console.log(
    `  ${b.bodyPart.padEnd(10)} ${String(b.sets).padStart(3)} sets  ` +
      `${b.daysSince === null ? "never in window" : b.daysSince + "d ago"}  ` +
      `${(b.share * 100).toFixed(0)}%`
  );
}

console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED` : "")
);
process.exit(failures ? 1 : 0);
