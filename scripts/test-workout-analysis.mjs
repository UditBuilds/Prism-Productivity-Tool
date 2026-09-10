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
// The mapping itself is asserted directly too, not only through the analysis:
// a body-part miss is a property of these functions, and a check that has to
// build a whole analysis to see one reports the failure a step away from it.
const {
  EXERCISE_ALIASES,
  EXERCISE_LIBRARY,
  bodyPartForExercise,
  unknownAliasKeys,
} = await import(pathToFileURL(path.join(out, "exercise-library.js")).href);
const { exerciseKey } = await import(
  pathToFileURL(path.join(out, "workouts.js")).href
);

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

/** A WorkoutSet row, shaped like the live table. */
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
  // free-text capture (Back), and the four names the library did not know.
  // Those four are the real defect this suite was extended for — before the
  // alias map they all fell to "Other", and the last two were their user's
  // ONLY shoulder and core work, so the dashboard told him to train both.
  const sets = [
    set("Leg Press", "2026-08-30T12:00:00.000Z", 100, 15, 1),
    set("Lat Pulldown", "2026-08-30T12:00:00.000Z", 70, null, 2),
    set("Flat Bench Press", "2026-08-11T12:00:00.000Z", 90, 2, 3),
    set("Flat Bench Press", "2026-09-01T12:00:00.000Z", 70, 8, 4),
    set("Dumbbell Curl", "2026-08-30T12:00:00.000Z", 15, 16, 5),
    set("Lateral Raise Drop Set", "2026-08-30T12:00:00.000Z", 10, 14, 6),
    set("Crunch", "2026-08-30T12:00:00.000Z", null, 20, 7),
    set("Hacksquat", "2026-08-30T12:00:00.000Z", 80, 10, 8),
    set("Hyper Extension", "2026-08-30T12:00:00.000Z", null, 12, 9),
  ];
  const analysis = analyseWorkoutSets(sets, 180, "2026-09-03");

  eq(
    "every library group is still present in the analysis",
    analysis.bodyParts.filter((b) => b.bodyPart !== "Other").length,
    6
  );
  // WAS "unmapped name is counted under Other, not dropped", asserting 1 set
  // there. All four of those names map now, so an "Other" row would mean the
  // alias map had stopped working — its ABSENCE is the assertion.
  eq(
    "no Other row: every name in the fixture now maps",
    analysis.bodyParts.find((b) => b.bodyPart === "Other"),
    undefined
  );
  eq(
    "nothing is reported unmapped",
    analysis.unmappedExercises,
    []
  );
  // WAS "Shoulders reads untrained despite a real lateral raise (mapping
  // defect)", asserting daysSince === null. That check encoded the bug; it is
  // inverted here rather than deleted so the regression it guards stays named.
  eq(
    "Shoulders reads TRAINED from the drop set (defect fixed)",
    analysis.bodyParts.find((b) => b.bodyPart === "Shoulders")?.daysSince,
    4
  );
  eq(
    "Core reads TRAINED from the crunch (defect fixed)",
    analysis.bodyParts.find((b) => b.bodyPart === "Core")?.daysSince,
    4
  );
  eq(
    "selector now finds no untrained group",
    names(untrainedBodyParts(analysis.bodyParts)),
    []
  );
  // The whole point of the fix, stated as set counts rather than dates.
  eq(
    "Hacksquat's sets land in Legs beside Leg Press",
    analysis.bodyParts.find((b) => b.bodyPart === "Legs")?.sets,
    2
  );
  eq(
    "Hyper Extension's sets land in Back beside Lat Pulldown",
    analysis.bodyParts.find((b) => b.bodyPart === "Back")?.sets,
    2
  );
  // Aliasing must not merge two exercises into one progression row — that
  // would compare weights across different lifts. Crunch stays its own row.
  eq(
    "aliasing does not merge progressions",
    analysis.progressions.filter((p) => p.exercise === "Crunch").length,
    1
  );
  eq(
    "an aliased progression still carries its resolved body part",
    analysis.progressions.find((p) => p.exercise === "Crunch")?.bodyPart,
    "Core"
  );
}

console.log("\nunmapped names are reported, not hidden");
{
  const sets = [
    set("Leg Press", "2026-08-30T12:00:00.000Z", 100, 15, 1),
    set("Sled Push", "2026-08-30T12:00:00.000Z", 40, 20, 2),
    set("Sled Push", "2026-09-01T12:00:00.000Z", 45, 20, 3),
    set("Zercher Carry", "2026-08-30T12:00:00.000Z", 60, null, 4),
  ];
  const analysis = analyseWorkoutSets(sets, 180, "2026-09-03");

  eq(
    "both unknown names are named, most sets first",
    analysis.unmappedExercises.map((u) => u.name),
    ["Sled Push", "Zercher Carry"]
  );
  eq(
    "with their set counts",
    analysis.unmappedExercises.map((u) => u.sets),
    [2, 1]
  );
  eq(
    "and the same normalised key everything else groups on",
    analysis.unmappedExercises.map((u) => u.key),
    ["sled push", "zercher carry"]
  );
  // The report must agree with the "Other" row it explains, or the panel
  // would print names whose sets were counted somewhere else.
  eq(
    "report total equals the Other row's set count",
    analysis.unmappedExercises.reduce((n, u) => n + u.sets, 0),
    analysis.bodyParts.find((b) => b.bodyPart === "Other")?.sets
  );
  eq(
    "distinct-name count equals the Other row's exercise count",
    analysis.unmappedExercises.length,
    analysis.bodyParts.find((b) => b.bodyPart === "Other")?.exercises
  );
  // A null-exercise row never parsed; it is already counted as unparsedSets
  // and has no name to report.
  const withNull = analyseWorkoutSets(
    sets.concat([set(null, "2026-09-01T12:00:00.000Z", null, null, null)]),
    180,
    "2026-09-03"
  );
  eq("unparsed rows are not reported as unmapped names",
    withNull.unmappedExercises.length, 2);
  eq("unparsed rows are still counted", withNull.unparsedSets, 1);
}

console.log("\nbodyPartForExercise — the four confirmed real-table misses");
{
  const cases = [
    // [logged name, expected group, why it used to miss]
    ["Crunch", "Core", "missing base exercise"],
    ["Hacksquat", "Legs", "spacing variant"],
    ["Hyper Extension", "Back", "synonym"],
    ["Lateral Raise Drop Set", "Shoulders", "qualified variant"],
  ];
  for (const [name, expected, why] of cases) {
    eq(`${name} -> ${expected} (${why})`, bodyPartForExercise(name), expected);
  }
  // The behaviour the brief names: same bucket as the library entry it
  // borrows from, verified by asking the library entry directly.
  eq(
    "Crunch shares Cable Crunch's bucket",
    bodyPartForExercise("Crunch"),
    bodyPartForExercise("Cable Crunch")
  );
  eq(
    "Hacksquat shares Hack Squat's bucket",
    bodyPartForExercise("Hacksquat"),
    bodyPartForExercise("Hack Squat")
  );
  eq(
    "Hyper Extension shares Back Extension's bucket",
    bodyPartForExercise("Hyper Extension"),
    bodyPartForExercise("Back Extension")
  );
  eq(
    "Lateral Raise Drop Set shares Lateral Raise's bucket",
    bodyPartForExercise("Lateral Raise Drop Set"),
    bodyPartForExercise("Lateral Raise")
  );
}

console.log("\nbodyPartForExercise — normalisation and qualifier stripping");
{
  eq("case and spacing still collapse", bodyPartForExercise("  cRuNcH  "), "Core");
  eq("alias through a qualifier", bodyPartForExercise("Crunch Drop Set"), "Core");
  eq("dropset, one word", bodyPartForExercise("Lateral Raise Dropset"), "Shoulders");
  eq("superset", bodyPartForExercise("Leg Press Superset"), "Legs");
  eq("warm up", bodyPartForExercise("Squat Warm Up"), "Legs");
  eq("to failure", bodyPartForExercise("Bench Press To Failure"), "Chest");
  // A qualifier alone is not an exercise; stripping it would leave nothing.
  eq("a bare qualifier maps to nothing", bodyPartForExercise("Drop Set"), null);
  eq("empty string", bodyPartForExercise(""), null);
  eq("whitespace only", bodyPartForExercise("   "), null);
  eq("null name", bodyPartForExercise(null), null);
  eq("a genuinely unknown name still returns null",
    bodyPartForExercise("Sled Push"), null);
  // Only ONE qualifier is stripped, deliberately — a loop could chew a real
  // name down to nothing.
  eq("two qualifiers are not both stripped",
    bodyPartForExercise("Squat Warm Up Drop Set"), null);
}

console.log("\nthe alias map cannot quietly break the library");
{
  eq("no alias points at a name the library lacks", unknownAliasKeys(), []);
  // Aliases must never re-home a real exercise: a library name always wins.
  let clashes = [];
  for (const alias of Object.keys(EXERCISE_ALIASES)) {
    for (const entry of EXERCISE_LIBRARY) {
      for (const libName of entry.exercises) {
        if (exerciseKey(libName) === alias) clashes.push(libName);
      }
    }
  }
  eq("no alias key shadows a library name", clashes, []);
  // Every distinct exercise in the library maps to its own group, unchanged.
  let wrong = [];
  for (const entry of EXERCISE_LIBRARY) {
    for (const libName of entry.exercises) {
      if (bodyPartForExercise(libName) !== entry.group) wrong.push(libName);
    }
  }
  eq("all 66 library names still map to their own group", wrong, []);
  // A qualifier suffix must never be a substring rule that eats a real name.
  eq("Incline Bench Press is NOT counted as Bench Press's group by accident",
    bodyPartForExercise("Incline Bench Press"), "Chest");
  eq("Close Grip Bench Press keeps its own group",
    bodyPartForExercise("Close Grip Bench Press"), "Arms");
}

console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED` : "")
);
process.exit(failures ? 1 : 0);
