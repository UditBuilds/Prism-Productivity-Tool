/**
 * Unit checks for the dashboard's body-part selector in lib/workout-analysis.ts.
 *
 * The Training panel used to render all seven body-part cells and now renders
 * only the untrained ones, so the whole visible change of that block is this
 * one predicate. It is tested here rather than through the component because
 * the component is behind a login no agent can pass — a filter that can be
 * exercised directly should be.
 *
 * The fixtures are SHAPED like the live table but are not the live table: the
 * repo is public and workout rows are personal data. The real-corpus run is
 * recorded in the PR description instead.
 *
 * Run:  node scripts/test-workout-analysis.mjs
 *
 * Compiles with the project's own `typescript` devDependency — no test runner,
 * matching scripts/test-revisit-summary.mjs.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const out = mkdtempSync(path.join(tmpdir(), "prism-workout-"));
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
  // workout-analysis pulls in date, exercise-library and workouts; the "@/"
  // aliases have no tsconfig to resolve against in the temp dir, so rewrite
  // them to sibling ESM specifiers before tsc sees them.
  const srcs = [
    "types/database.ts",
    "lib/date.ts",
    "lib/workouts.ts",
    "lib/exercise-library.ts",
    "lib/workout-analysis.ts",
  ];
  for (const rel of srcs) {
    const text = readFileSync(path.join(root, rel), "utf8")
      .replace(/["']@\/types\/database["']/g, '"./database.js"')
      .replace(/["']@\/lib\/date["']/g, '"./date.js"')
      .replace(/["']@\/lib\/workouts["']/g, '"./workouts.js"')
      .replace(/["']@\/lib\/exercise-library["']/g, '"./exercise-library.js"');
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
  return import(pathToFileURL(path.join(out, "workout-analysis.js")).href);
}

const { analyseWorkoutSets, untrainedBodyParts } = await compile();

/** A BodyPartLoad, only the fields the selector reads. */
const part = (bodyPart, daysSince) => ({
  bodyPart,
  sets: daysSince === null ? 0 : 3,
  exercises: daysSince === null ? 0 : 1,
  lastTrained: daysSince === null ? null : "2026-08-30",
  daysSince,
  share: 0,
});

const names = (list) => list.map((b) => b.bodyPart);

console.log("\nuntrainedBodyParts — mixed input returns only untrained groups");
{
  // The endpoint's own order: never-trained first, then longest-untrained.
  const mixed = [
    part("Shoulders", null),
    part("Core", null),
    part("Other", 4),
    part("Legs", 4),
    part("Back", 4),
    part("Chest", 2),
    part("Arms", 2),
  ];
  eq("keeps only daysSince === null", names(untrainedBodyParts(mixed)), [
    "Shoulders",
    "Core",
  ]);
  eq("input is not mutated", names(mixed).length, 7);
}

console.log("\nuntrainedBodyParts — all-trained input omits the block");
{
  const allTrained = [
    part("Chest", 0),
    part("Back", 1),
    part("Legs", 7),
    part("Shoulders", 30),
    part("Arms", 2),
    part("Core", 179),
  ];
  const result = untrainedBodyParts(allTrained);
  eq("returns empty", names(result), []);
  // The component gates the whole sub-block on this being non-empty, so an
  // empty result is what suppresses the heading too.
  eq("length 0 -> block omitted", result.length === 0, true);
}

console.log("\nuntrainedBodyParts — boundary cases");
{
  eq("empty input", names(untrainedBodyParts([])), []);
  // 0 is "trained today", NOT untrained. A falsy check instead of an explicit
  // null test would drop today's session out of the trained half.
  eq(
    "daysSince 0 counts as trained",
    names(untrainedBodyParts([part("Chest", 0), part("Core", null)])),
    ["Core"]
  );
  eq(
    "all untrained returns all, in input order",
    names(
      untrainedBodyParts([
        part("Chest", null),
        part("Back", null),
        part("Legs", null),
      ])
    ),
    ["Chest", "Back", "Legs"]
  );
}

console.log("\nend-to-end through analyseWorkoutSets");
{
  // Rows shaped like the live table: a picker capture (Legs), a Groq-parsed
  // free-text capture (Back), and one name the library does not know — which
  // must land in "Other" rather than in the group it actually trains. That
  // last row is the shape of the live mapping defect: a real shoulder set
  // logged as "Lateral Raise Drop Set" leaves Shoulders reading untrained.
  const set = (exercise, performed_at, weight_kg, reps, set_index) => ({
    id: `${exercise}-${set_index}`,
    user_id: "u",
    exercise,
    weight_kg,
    reps,
    set_index,
    performed_at,
    raw_input: null,
    created_at: performed_at,
  });
  const sets = [
    set("Leg Press", "2026-08-30T12:00:00.000Z", 100, 15, 1),
    set("Lat Pulldown", "2026-08-30T12:00:00.000Z", 70, null, 2),
    set("Flat Bench Press", "2026-08-11T12:00:00.000Z", 90, 2, 3),
    set("Flat Bench Press", "2026-09-01T12:00:00.000Z", 70, 8, 4),
    set("Dumbbell Curl", "2026-08-30T12:00:00.000Z", 15, 16, 5),
    set("Lateral Raise Drop Set", "2026-08-30T12:00:00.000Z", 10, 14, 6),
  ];
  const analysis = analyseWorkoutSets(sets, 180, "2026-09-03");

  eq(
    "every library group is still present in the analysis",
    analysis.bodyParts.filter((b) => b.bodyPart !== "Other").length,
    6
  );
  eq(
    "unmapped name is counted under Other, not dropped",
    analysis.bodyParts.find((b) => b.bodyPart === "Other")?.sets,
    1
  );
  eq(
    "selector picks the untrained groups out of that",
    names(untrainedBodyParts(analysis.bodyParts)),
    ["Shoulders", "Core"]
  );
  eq(
    "Shoulders reads untrained despite a real lateral raise (mapping defect)",
    analysis.bodyParts.find((b) => b.bodyPart === "Shoulders")?.daysSince,
    null
  );
}

console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED` : "")
);
process.exit(failures ? 1 : 0);
