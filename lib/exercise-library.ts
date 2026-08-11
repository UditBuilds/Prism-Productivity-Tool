import type { WorkoutSet } from "@/types/database";

/**
 * The exercise picker's list: a static in-code library merged with whatever the
 * user has actually logged.
 *
 * NO DATABASE TABLE. The library is reference data with no per-user state — a
 * table would need RLS, a seed, a migration and a fetch to say exactly what
 * this file says, and the user's own history already lives in ["workouts"].
 */

/**
 * Case-insensitive identity for an exercise name.
 *
 * This MUST agree with groupSetsByExercise in lib/workouts.ts, which keys on
 * `exercise.toLowerCase()` and lets the first spelling seen win the label. If
 * the picker and the display disagreed about what counts as the same exercise,
 * a name picked here could still land as a second group in today's list.
 *
 * Whitespace collapse goes one step beyond that (the brief asked for
 * case-insensitive "at minimum"): `PATCH /api/workouts` writes whatever the
 * inline editor's free text field holds, so "Close  Grip Row" is reachable by
 * a fat-fingered correction in a way a mis-cased name is not.
 *
 * Measured on the real table (15 rows, 5 distinct names — Flat Bench Press,
 * Pull Up, Chin Up, Close Grip Row, Lat Pulldown) this is currently a no-op:
 * there are no case variants, because the Groq prompt pins Title Case singular
 * at temperature 0. It guards the hand-editing path, not the AI one.
 */
export function exerciseKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

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
 * True when `query` is a usable exercise name that no section already offers —
 * i.e. the picker should offer to use it verbatim.
 *
 * This is what makes the picker a combobox rather than a dropdown, and it is
 * what stops the library's coverage from becoming a ceiling: an exercise typed
 * once here is in "Recent" forever after. The free-text box remains the
 * fallback for a whole session in one line; this is the fallback for one name.
 */
export function isNovelExerciseName(
  sections: ExerciseSection[],
  query: string
): boolean {
  const trimmed = query.trim();
  if (trimmed === "") return false;
  const key = exerciseKey(trimmed);
  for (const section of sections) {
    for (const option of section.options) {
      if (option.key === key) return false;
    }
  }
  return true;
}
