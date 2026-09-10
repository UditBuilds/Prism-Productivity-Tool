import { exerciseKey } from "@/lib/workouts";
import type { WorkoutSet } from "@/types/database";

/**
 * The exercise picker's list: a static in-code library merged with whatever the
 * user has actually logged.
 *
 * NO DATABASE TABLE. The library is reference data with no per-user state — a
 * table would need RLS, a seed, a migration and a fetch to say exactly what
 * this file says, and the user's own history already lives in ["workouts"].
 *
 * `exerciseKey` used to live here and now lives in lib/workouts.ts, imported
 * above. The dependency had to point this way round: lib/workouts is what the
 * DASHBOARD needs (it groups and counts sets), so with the key here, every
 * chunk that touched workout data also pulled in all 66 library names. Verified
 * against the real build — "Barbell Bench Press" was in the /dashboard chunk.
 * The key is also where its own contract says it belongs, next to the
 * groupSetsByExercise it must agree with.
 */

/**
 * Names follow the SAME convention as lib/ai/workout.ts's prompt: conventional
 * Title Case, SINGULAR ("Squat" not "Squats"), with grip/angle/assistance
 * modifiers as part of the name rather than dropped. Free-text captures and
 * picker captures therefore produce identical strings and group together.
 *
 * `Assisted Pull Up` / `Assisted Chin Up` are here deliberately. The oldest
 * rows in the real table logged "Assisted pullup and chinups" as plain `Pull
 * Up` / `Chin Up` — they predate the prompt's modifier rule, and claiming
 * unassisted work that wasn't done is exactly the loss the picker should make
 * impossible.
 */
export const EXERCISE_LIBRARY: ReadonlyArray<{
  group: string;
  exercises: ReadonlyArray<string>;
}> = [
  {
    group: "Chest",
    exercises: [
      "Bench Press",
      "Flat Bench Press",
      "Incline Bench Press",
      "Decline Bench Press",
      "Dumbbell Bench Press",
      "Incline Dumbbell Press",
      "Machine Chest Press",
      "Chest Fly",
      "Cable Fly",
      "Push Up",
      "Dip",
    ],
  },
  {
    group: "Back",
    exercises: [
      "Deadlift",
      "Barbell Row",
      "Dumbbell Row",
      "Single Arm Row",
      "Close Grip Row",
      "Seated Cable Row",
      "Lat Pulldown",
      "Close Grip Lat Pulldown",
      "Pull Up",
      "Assisted Pull Up",
      "Chin Up",
      "Assisted Chin Up",
      "Face Pull",
      "Shrug",
      "Back Extension",
    ],
  },
  {
    group: "Legs",
    exercises: [
      "Squat",
      "Front Squat",
      "Goblet Squat",
      "Hack Squat",
      "Leg Press",
      "Romanian Deadlift",
      "Lunge",
      "Walking Lunge",
      "Bulgarian Split Squat",
      "Leg Extension",
      "Leg Curl",
      "Hip Thrust",
      "Glute Bridge",
      "Calf Raise",
      "Seated Calf Raise",
    ],
  },
  {
    group: "Shoulders",
    exercises: [
      "Overhead Press",
      "Seated Overhead Press",
      "Dumbbell Shoulder Press",
      "Arnold Press",
      "Lateral Raise",
      "Front Raise",
      "Rear Delt Fly",
      "Upright Row",
    ],
  },
  {
    group: "Arms",
    exercises: [
      "Barbell Curl",
      "Dumbbell Curl",
      "Hammer Curl",
      "Preacher Curl",
      "Cable Curl",
      "Concentration Curl",
      "Tricep Pushdown",
      "Overhead Tricep Extension",
      "Skull Crusher",
      "Close Grip Bench Press",
      "Tricep Dip",
    ],
  },
  {
    group: "Core",
    exercises: [
      "Plank",
      "Hanging Leg Raise",
      "Cable Crunch",
      "Sit Up",
      "Russian Twist",
      "Ab Wheel Rollout",
    ],
  },
];

/**
 * The body parts, in library order. DERIVED from EXERCISE_LIBRARY rather than
 * written out again, so adding a group above cannot leave a second list stale.
 *
 * This is the analysis vocabulary as well as the picker's, which is the whole
 * reason the lookup below reads `group` instead of a new field: the section
 * heading the user picks an exercise under IS the body part they trained. A
 * parallel `bodyPart` attribute could disagree with the heading, and then the
 * picker and the analysis would be telling the user two different things.
 */
export const BODY_PARTS: ReadonlyArray<string> = EXERCISE_LIBRARY.map(
  (entry) => entry.group
);

/**
 * Where an exercise's sets are counted when a name is not in the library.
 *
 * Freeform picker entries and Groq-parsed free text can both produce names the
 * library has never heard of, and they must land SOMEWHERE visible: silently
 * dropping them would make the balance read as though that work never happened,
 * which is the exact error the feature exists to prevent.
 */
export const UNCLASSIFIED_BODY_PART = "Other";

/**
 * Names the library does not list, mapped to the library name whose BODY PART
 * they share. The key on the left is an `exerciseKey`; the value must be a
 * name that literally appears in EXERCISE_LIBRARY above.
 *
 * WHY THIS EXISTS. Mapping used to be an exact `exerciseKey` match, so a name
 * the library had never seen fell to `UNCLASSIFIED_BODY_PART`. Measured on the
 * real table (154 rows, 26 distinct names, 2026-09-10) exactly four names
 * missed, and all four were one user's: "Crunch", "Hacksquat", "Hyper
 * Extension" and "Lateral Raise Drop Set". Crunch was that user's ONLY core
 * work and the drop set his ONLY shoulder work, so the dashboard told him to
 * train two groups he had already trained — a confidently wrong instruction,
 * which is worse than no instruction.
 *
 * BODY PART ONLY — NOT IDENTITY. An alias resolves which group a set is
 * COUNTED under. It deliberately does NOT feed `exerciseKey`,
 * `groupSetsByExercise` or `resolveExerciseName`, so "Crunch" and "Cable
 * Crunch" stay two separate rows with two separate progressions. Merging them
 * would compare weights across two different exercises, which is exactly the
 * failure `resolveExerciseName`'s own comment refuses fuzzy matching to avoid.
 *
 * NOT FUZZY MATCHING. Every entry is an exact, hand-checked pair. There is no
 * edit distance, no stemming and no scoring, so nothing here can decide on its
 * own that two real exercises are the same. Adding a name is a one-line edit a
 * reader can check against the library by eye; that is the whole design. A new
 * entry needs a real justification — an unmapped name actually observed (see
 * `collectUnmappedExercises`), not a guess about what someone might type.
 */
export const EXERCISE_ALIASES: Readonly<Record<string, string>> = {
  // --- the four confirmed misses on the real table -----------------------
  // Missing base exercise: the library lists only the cable variant.
  crunch: "Cable Crunch",
  // Spacing variant of a name the library already has.
  hacksquat: "Hack Squat",
  // Synonym: the same movement under the name most gyms label the bench with.
  "hyper extension": "Back Extension",
  // "Lateral Raise Drop Set" needs no entry — QUALIFIER_SUFFIXES strips the
  // technique and the base name is already in the library. It is named here in
  // prose so all four confirmed misses are findable from one place.

  // --- same-shape variants of names already in the library ---------------
  // Spacing variants. Safe because each collapses onto exactly one library
  // name; none of them is ambiguous between two.
  hyperextension: "Back Extension",
  pushup: "Push Up",
  situp: "Sit Up",
  pullup: "Pull Up",
  chinup: "Chin Up",
  // Plurals and synonyms in common gym use.
  deadlifts: "Deadlift",
  rdl: "Romanian Deadlift",
  "ab crunch": "Cable Crunch",
  "sit ups": "Sit Up",
  "tricep extension": "Overhead Tricep Extension",
  "lat pull down": "Lat Pulldown",
  "calf raises": "Calf Raise",
};

/**
 * Technique/intensity qualifiers that can trail a real exercise name.
 *
 * Stripped before matching, so "Lateral Raise Drop Set" is counted as
 * shoulders. Every entry names HOW a set was performed, never WHICH muscle it
 * trained — that is the admission test for this list. "Machine", "Incline" and
 * "Close Grip" are absent for that reason: they change the exercise, and
 * "Incline Bench Press" must never be counted as plain "Bench Press".
 *
 * Applied ONCE, not in a loop — a name needing two qualifiers stripped is rare
 * enough to deserve an explicit alias instead of a rule that could chew a real
 * name down to nothing.
 */
export const QUALIFIER_SUFFIXES: ReadonlyArray<string> = [
  "drop set",
  "dropset",
  "super set",
  "superset",
  "giant set",
  "rest pause",
  "restpause",
  "pyramid set",
  "failure set",
  "to failure",
  "warm up",
  "warmup",
  "burnout",
  "amrap",
];

/**
 * normalised exercise name -> body part, built once on first use.
 *
 * Object rather than Map, and Object.keys rather than an iterator, because
 * tsconfig pins ES5 iteration (see CLAUDE.md, Session 5) — a `for…of` over
 * `map.entries()` does not downlevel here.
 *
 * Aliases are folded in HERE rather than checked at lookup time, so an alias
 * costs the same single lookup a library name does. An alias whose target is
 * not a real library name is dropped rather than indexed — a typo in the map
 * can therefore only fail to help, never invent a body part. The orphans are
 * recorded so the test suite can fail on them.
 */
let bodyPartIndex: Record<string, string> | null = null;
let unknownAliasTargets: string[] | null = null;

function getBodyPartIndex(): Record<string, string> {
  if (bodyPartIndex) return bodyPartIndex;
  const index: Record<string, string> = {};
  for (const entry of EXERCISE_LIBRARY) {
    for (const name of entry.exercises) {
      index[exerciseKey(name)] = entry.group;
    }
  }
  const unknown: string[] = [];
  for (const alias of Object.keys(EXERCISE_ALIASES)) {
    const target = index[exerciseKey(EXERCISE_ALIASES[alias])];
    if (target === undefined) {
      unknown.push(alias);
      continue;
    }
    // A library name always wins over an alias claiming the same key, so the
    // map can never quietly re-home a real exercise.
    if (index[alias] === undefined) index[alias] = target;
  }
  unknownAliasTargets = unknown;
  bodyPartIndex = index;
  return index;
}

/**
 * Alias keys whose target is not a name in EXERCISE_LIBRARY — always empty in
 * a healthy build. Exported so scripts/test-workout-analysis.mjs can assert it,
 * which is what stops a renamed library entry from silently orphaning an alias.
 */
export function unknownAliasKeys(): string[] {
  getBodyPartIndex();
  return (unknownAliasTargets ?? []).slice();
}

/**
 * `key` with one trailing qualifier removed, or null when it had none.
 *
 * Guards against the empty result: "Drop Set" on its own is not a qualified
 * exercise, it is only a qualifier, and stripping it would leave nothing to
 * match.
 */
function stripQualifierSuffix(key: string): string | null {
  for (const suffix of QUALIFIER_SUFFIXES) {
    if (key.length <= suffix.length) continue;
    if (key.slice(key.length - suffix.length) !== suffix) continue;
    const base = key.slice(0, key.length - suffix.length).trim();
    if (base !== "") return base;
  }
  return null;
}

/**
 * The body part an exercise trains, or null when nothing knows it.
 *
 * ONE PRIMARY GROUP PER EXERCISE, deliberately. Real lifts are not so tidy —
 * "Deadlift" sits under Back but is most of a leg session, and "Dip" under
 * Chest does real triceps work — so a multi-muscle weighting model would be
 * more anatomically honest. It is not used because the weights would be
 * invented: nothing in the logged data says what fraction of a deadlift is
 * posterior chain, and a made-up 0.6/0.4 split would dress a guess up as a
 * measurement. One group per exercise is a simplification the user can see and
 * correct for, which a hidden weighting is not.
 *
 * Resolution order, each step exact and each one auditable:
 *   1. the library / alias index on `exerciseKey` — the same identity
 *      groupSetsByExercise uses, so a hand-corrected "flat bench press"
 *      resolves exactly like the picker's "Flat Bench Press";
 *   2. failing that, strip ONE known qualifier suffix and try the index again.
 *
 * Still returns null for a genuinely unknown name. That null is the honest
 * answer and callers count it under `UNCLASSIFIED_BODY_PART` — see
 * `collectUnmappedExercises`, which is what makes the remainder visible rather
 * than letting it vanish into "Other" the way these four names did.
 */
export function bodyPartForExercise(name: string | null): string | null {
  if (name === null) return null;
  const key = exerciseKey(name);
  if (key === "") return null;
  const index = getBodyPartIndex();
  const direct = index[key];
  if (direct !== undefined) return direct;
  const base = stripQualifierSuffix(key);
  if (base === null) return null;
  return index[base] ?? null;
}

/**
 * How many history names the "Recent" section shows. Recency stops being
 * information somewhere, and a picker whose first screen is 30 names is the
 * scrolling problem the picker exists to remove.
 *
 * 16, RAISED FROM 8, AND THE TWO NUMBERS ARE COUPLED. 8 was sized against a
 * 21-day source window. GET /api/workouts now reaches 60 days precisely so
 * that a body part trained three weeks ago is still reachable without
 * scrolling the library — and widening the window alone did NOT deliver that.
 * Measured on the real table the moment the window changed: 13 distinct
 * exercises came into range, the 8 most recent (one Legs day plus one Arms
 * day) filled the list exactly, and the 2026-08-04 Back session ranked 9th
 * through 12th and was still cut. Lat Pulldown stayed 1267px down the library,
 * Pull Up 1391px — byte-identical to before the window moved.
 *
 * So the cap, not the window, was the binding constraint. 16 is one full
 * training rotation (four sessions of four exercises), which is the unit that
 * matters here: it is the smallest number that lets a four-way split come all
 * the way back round without a name falling off the end. Raising the window
 * without raising this is a no-op for the user, and lowering this back to 8
 * silently re-breaks the thing the 60-day window was for.
 */
const MAX_RECENT = 16;

export interface ExerciseOption {
  /** Normalised identity — stable React key, and the dedupe key. */
  key: string;
  /** What to display: the user's own most recent spelling, or the library's. */
  name: string;
}

export interface ExerciseSection {
  heading: string;
  options: ExerciseOption[];
}

/**
 * Most recent first, one entry per distinct exercise.
 *
 * Sorted here rather than trusting the caller: GET /api/workouts returns
 * performed_at ASC, and the ["workouts"] cache additionally carries optimistic
 * rows appended at the end, so neither end of the array is reliably "latest".
 */
export function recentExercises(sets: ReadonlyArray<WorkoutSet>): string[] {
  const named = sets.filter(
    (s) => typeof s.exercise === "string" && s.exercise.trim() !== ""
  );

  const ordered = named.slice().sort((a, b) => {
    const at = Date.parse(a.performed_at);
    const bt = Date.parse(b.performed_at);
    if (at !== bt) return bt - at;
    // Within one capture, the last set performed is the most recent. Null
    // set_index (an unparsed row) sorts oldest — it has no position to claim.
    return (b.set_index ?? -1) - (a.set_index ?? -1);
  });

  const seen: Record<string, true> = {};
  const names: string[] = [];
  for (const set of ordered) {
    // Non-null by the filter above; TS can't see through it.
    const raw = (set.exercise as string).trim();
    const key = exerciseKey(raw);
    if (seen[key]) continue;
    seen[key] = true;
    names.push(raw);
    if (names.length >= MAX_RECENT) break;
  }
  return names;
}

/**
 * The picker's full list: the user's recent exercises on top, then the static
 * library by body part, with every library entry the user has already logged
 * removed from its body-part group so no name appears twice.
 *
 * `query` filters by case-insensitive substring across both. An empty query
 * returns everything.
 */
export function buildExerciseSections(
  sets: ReadonlyArray<WorkoutSet>,
  query = ""
): ExerciseSection[] {
  const needle = exerciseKey(query);
  const matches = (name: string) =>
    needle === "" || exerciseKey(name).indexOf(needle) !== -1;

  const recentNames = recentExercises(sets);
  const recentKeys: Record<string, true> = {};
  for (const name of recentNames) recentKeys[exerciseKey(name)] = true;

  const sections: ExerciseSection[] = [];

  const recentOptions = recentNames
    .filter(matches)
    .map((name) => ({ key: exerciseKey(name), name }));
  if (recentOptions.length > 0) {
    sections.push({ heading: "Recent", options: recentOptions });
  }

  for (const entry of EXERCISE_LIBRARY) {
    const options = entry.exercises
      .filter((name) => !recentKeys[exerciseKey(name)] && matches(name))
      .map((name) => ({ key: exerciseKey(name), name }));
    if (options.length > 0) {
      sections.push({ heading: entry.group, options });
    }
  }

  return sections;
}

/**
 * Capitalise the first letter of each word, leaving everything else as typed.
 *
 * Deliberately NOT `lowercase-the-rest` Title Case: that would turn a typed
 * "RDL" into "Rdl". Only a lowercase letter at a word boundary is touched, so
 * acronyms and internal capitals survive.
 *
 * This exists because the picker writes `exercise` straight to the column, and
 * every other writer of that column produces Title Case singular — the static
 * library by hand, the Groq path by prompt rule. A freeform "sled push" stored
 * verbatim would sit in the list as the one lowercase name forever, since
 * groupSetsByExercise labels a group with the first spelling it sees.
 */
export function toTitleCase(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(^|[\s\-/(])([a-z])/g, (_m, pre: string, ch: string) =>
      pre + ch.toUpperCase()
    );
}

/**
 * Every name the picker knows: the user's FULL history (uncapped) plus the
 * whole static library, deduped on the normalised key.
 *
 * Uncapped is the point. recentExercises() stops at MAX_RECENT because that is
 * how long a "Recent" list should be, but using that same capped list to decide
 * whether a typed name is new is how near-duplicates get in: log 20 distinct
 * exercises, type a case variant of the 15th, and a capped check calls it novel
 * because it fell off the display list.
 */
function allKnownExerciseNames(sets: ReadonlyArray<WorkoutSet>): string[] {
  const names: string[] = [];
  const seen: Record<string, true> = {};

  const push = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    const key = exerciseKey(name);
    if (seen[key]) return;
    seen[key] = true;
    names.push(name);
  };

  // History first, newest first, so the user's own spelling is the canonical
  // one when it differs from the library's.
  for (const set of sets
    .filter((s) => typeof s.exercise === "string" && s.exercise.trim() !== "")
    .slice()
    .sort((a, b) => {
      const at = Date.parse(a.performed_at);
      const bt = Date.parse(b.performed_at);
      if (at !== bt) return bt - at;
      return (b.set_index ?? -1) - (a.set_index ?? -1);
    })) {
    push(set.exercise as string);
  }

  for (const entry of EXERCISE_LIBRARY) {
    for (const name of entry.exercises) push(name);
  }

  return names;
}

/** An exercise name nothing in the library or the alias map recognises. */
export interface UnmappedExercise {
  /** Normalised identity — the same `exerciseKey` everything else groups on. */
  key: string;
  /** The name as most recently logged, i.e. what the user would search for. */
  name: string;
  /** How many sets carried it. */
  sets: number;
}

/**
 * Every logged name that still fails to map, most sets first.
 *
 * THE POINT OF THIS FUNCTION IS THAT THE REMAINDER STAYS VISIBLE. Before the
 * alias map, four unmapped names were being counted under "Other" and nothing
 * anywhere said which names they were — the miss was indistinguishable from a
 * deliberate catch-all, which is why it survived long enough to tell a user to
 * train a body part he had trained that week. An alias map alone would have
 * fixed those four and left the next four just as invisible.
 *
 * Rows with a null `exercise` are excluded: they never parsed at all, they are
 * already counted as `unparsedSets`, and they carry no name to report.
 */
export function collectUnmappedExercises(
  sets: ReadonlyArray<WorkoutSet>
): UnmappedExercise[] {
  const byKey: Record<string, { name: string; sets: number; latestAt: number }> =
    {};

  for (const set of sets) {
    if (typeof set.exercise !== "string") continue;
    const name = set.exercise.trim();
    if (name === "") continue;
    if (bodyPartForExercise(name) !== null) continue;

    const key = exerciseKey(name);
    const at = Date.parse(set.performed_at);
    const seen = byKey[key];
    if (!seen) {
      byKey[key] = { name, sets: 1, latestAt: at };
      continue;
    }
    seen.sets += 1;
    // Newest spelling wins the label, matching groupSetsByExercise's habit of
    // showing the user their own most recent wording.
    if (at >= seen.latestAt) {
      seen.latestAt = at;
      seen.name = name;
    }
  }

  return Object.keys(byKey)
    .map((key) => ({ key, name: byKey[key].name, sets: byKey[key].sets }))
    .sort((a, b) =>
      a.sets !== b.sets ? b.sets - a.sets : a.name.localeCompare(b.name)
    );
}

/** What a freeform picker entry resolves to. */
export interface ResolvedExerciseName {
  /** The name to actually log. */
  name: string;
  /** True when it matched something already known, so `name` is that name. */
  existing: boolean;
}

/**
 * Resolve what the user typed into the name that should be stored.
 *
 * A normalised match against ANY known name wins and returns that name
 * verbatim — typing "bench  PRESS" logs the existing "Bench Press" rather than
 * a second spelling of it. Only a genuinely unknown name is accepted, and then
 * it is Title Cased first so it joins the list looking like everything else.
 *
 * Exact-key matching only. Fuzzy/Levenshtein matching is deliberately absent:
 * it would have to decide that "Incline Bench Press" and "Decline Bench Press"
 * are different (edit distance 2) while "Pushup" and "Push Up" are the same,
 * and getting that wrong silently merges two real exercises — a worse failure
 * than the duplicate it prevents.
 */
export function resolveExerciseName(
  sets: ReadonlyArray<WorkoutSet>,
  query: string
): ResolvedExerciseName {
  const key = exerciseKey(query);
  for (const known of allKnownExerciseNames(sets)) {
    if (exerciseKey(known) === key) return { name: known, existing: true };
  }
  return { name: toTitleCase(query), existing: false };
}

/**
 * True when `query` is a usable exercise name nothing already knows — i.e. the
 * picker should offer to add it.
 *
 * This is what makes the picker a combobox rather than a dropdown, and it is
 * what stops the library's coverage from becoming a ceiling: an exercise typed
 * once here is in "Recent" forever after. The free-text box remains the
 * fallback for a whole session in one line; this is the fallback for one name.
 *
 * Checked against the FULL known list rather than the rendered sections, which
 * are both filtered by the query and capped at MAX_RECENT — see
 * allKnownExerciseNames.
 */
export function isNovelExerciseName(
  sets: ReadonlyArray<WorkoutSet>,
  query: string
): boolean {
  if (query.trim() === "") return false;
  return !resolveExerciseName(sets, query).existing;
}
