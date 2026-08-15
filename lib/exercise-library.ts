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
 * How many history names the "Recent" section shows. Recency stops being
 * information somewhere, and a picker whose first screen is 30 names is the
 * scrolling problem the picker exists to remove.
 */
const MAX_RECENT = 8;

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
