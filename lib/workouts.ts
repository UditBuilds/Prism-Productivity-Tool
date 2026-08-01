import { istDateString } from "@/lib/date";
import type { WorkoutSet } from "@/types/database";

/** Sets performed on one exercise, in the order they were logged. */
export interface ExerciseGroup {
  /** Display name; unparsed rows collapse under a single null-name group. */
  exercise: string | null;
  sets: WorkoutSet[];
}

/**
 * Group sets by exercise, preserving first-seen order. Rows that never parsed
 * (exercise null) collect into one group so they stay visible and correctable
 * rather than disappearing.
 */
export function groupSetsByExercise(sets: WorkoutSet[]): ExerciseGroup[] {
  const groups: ExerciseGroup[] = [];
  const byName = new Map<string, ExerciseGroup>();
  // Held in its own variable rather than under a magic map key, so no real
  // exercise name can ever collide with the unparsed bucket.
  let unparsed: ExerciseGroup | null = null;

  for (const set of sets) {
    if (set.exercise === null) {
      if (!unparsed) {
        unparsed = { exercise: null, sets: [] };
        groups.push(unparsed);
      }
      unparsed.sets.push(set);
      continue;
    }

    // Case-insensitive so a hand-corrected "bench press" doesn't split from
    // the AI's "Bench Press"; the first spelling seen wins as the label.
    const key = set.exercise.toLowerCase();
    let group = byName.get(key);
    if (!group) {
      group = { exercise: set.exercise, sets: [] };
      byName.set(key, group);
      groups.push(group);
    }
    group.sets.push(set);
  }

  return groups;
}

/**
 * Number of distinct IST days in `sets` that have at least one set — i.e.
 * sessions. This is the feature measuring its own use, so it counts days with
 * ANY row, parsed or not.
 */
export function countSessionDays(sets: WorkoutSet[]): number {
  const days = new Set<string>();
  for (const set of sets) {
    days.add(istDateString(Date.parse(set.performed_at)));
  }
  return days.size;
}

/**
 * "80 kg x 5" / "Bodyweight x 12" / "20 kg" — whatever the row actually has.
 */
export function formatSetLine(set: WorkoutSet): string {
  const weight =
    set.weight_kg === null
      ? null
      : // Trim the trailing ".00"/".50" noise numeric() round-trips produce.
        `${Number(set.weight_kg).toFixed(2).replace(/\.?0+$/, "")} kg`;

  if (weight && set.reps !== null) return `${weight} × ${set.reps}`;
  if (weight) return weight;
  if (set.reps !== null) return `Bodyweight × ${set.reps}`;
  return "Logged";
}
