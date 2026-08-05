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
 * "80 kg × 5" / "Bodyweight × 12" / "20 kg" / "Bodyweight" — whatever the row
 * actually has, and nothing it doesn't.
 *
 * The all-null case used to read "Logged", which told the reader nothing they
 * could not already see from the row existing. Six of them in a row (a real
 * "3 sets till failure" capture) was the whole card saying the same empty word.
 * "Bodyweight" is at least true: no weight recorded means the load was the
 * body. It is deliberately NOT "to failure" — that qualifier isn't stored, and
 * a column for it is deferred until there are more real rows to design against.
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
  return "Bodyweight";
}

/**
 * A run of CONSECUTIVE sets within one exercise group that are identical in
 * both weight and reps. `sets.length === 1` is the ordinary single-set case.
 */
export interface SetRun {
  /** Stable across renders: the id of the run's first set. */
  key: string;
  sets: WorkoutSet[];
}

/**
 * Two rows say the same thing and may share one display row.
 *
 * Unparsed rows (exercise null) NEVER merge. Their label is raw_input, not the
 * numbers, so two of them can be weight-null/reps-null and still read
 * completely differently — merging would hide one capture behind another's
 * text. Optimistic rows are unparsed by construction, so this also keeps the
 * in-flight spinner attached to exactly the row that is in flight.
 */
function sameSet(a: WorkoutSet, b: WorkoutSet): boolean {
  if (a.exercise === null || b.exercise === null) return false;
  return a.weight_kg === b.weight_kg && a.reps === b.reps;
}

/**
 * Collapse runs of identical CONSECUTIVE sets for display.
 *
 * PRESENTATION ONLY. Every row survives in the array untouched and stays
 * individually editable and deletable — nothing is written, nothing is summed,
 * no schema knows this happened.
 *
 * CONSECUTIVE is the whole point. 70×8, 70×8, 70×6 is TWO runs, not one and
 * not three: a drop set has a shape, and flattening it to "70 kg × 8 ×3" would
 * be a lie about the third set while "70 kg ×3" would be a lie about all of
 * them. A, B, A is likewise three runs — the return to A is information.
 *
 * Input order is preserved and never re-sorted, so a run is a contiguous slice
 * of the caller's array: expanding one renders its sets in their original
 * performed_at / set_index order.
 */
export function collapseConsecutiveSets(sets: WorkoutSet[]): SetRun[] {
  const runs: SetRun[] = [];

  for (const set of sets) {
    const current = runs[runs.length - 1];
    if (current && sameSet(current.sets[current.sets.length - 1], set)) {
      current.sets.push(set);
      continue;
    }
    runs.push({ key: set.id, sets: [set] });
  }

  return runs;
}
