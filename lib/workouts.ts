import { istDateString } from "@/lib/date";
import type { WorkoutSet } from "@/types/database";

/**
 * Case-insensitive identity for an exercise name.
 *
 * This MUST agree with groupSetsByExercise below, which keys on
 * `exercise.toLowerCase()` and lets the first spelling seen win the label. If
 * the picker and the display disagreed about what counts as the same exercise,
 * a name picked in the picker could still land as a second group in today's
 * list. It lives here, beside that function, rather than in
 * lib/exercise-library where it started: the library imports it, so keeping it
 * there put all 66 library names into every chunk that merely grouped sets —
 * the dashboard included.
 *
 * Whitespace collapse goes one step beyond case-insensitivity: `PATCH
 * /api/workouts` writes whatever the inline editor's free text field holds, so
 * "Close  Grip Row" is reachable by a fat-fingered correction in a way a
 * mis-cased name is not.
 *
 * Measured on the real table (15 rows, 5 distinct names — Flat Bench Press,
 * Pull Up, Chin Up, Close Grip Row, Lat Pulldown) this is currently a no-op:
 * there are no case variants, because the Groq prompt pins Title Case singular
 * at temperature 0. It guards the hand-editing path, not the AI one.
 */
export function exerciseKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

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
/** Trim the trailing ".00"/".50" noise numeric() round-trips produce. */
function formatWeightNumber(weightKg: number): string {
  return Number(weightKg).toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Takes only the two columns it reads, so a not-yet-saved set from the picker
 * formats through exactly the same function as a stored row — one definition
 * of what "80 kg × 5" looks like.
 */
export function formatSetLine(
  set: Pick<WorkoutSet, "weight_kg" | "reps">
): string {
  const weight =
    set.weight_kg === null ? null : `${formatWeightNumber(set.weight_kg)} kg`;

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

/**
 * One set as the structured picker submits it: already in kilograms, already
 * split per set. Nothing here needs parsing, which is the entire point — the
 * Groq round-trip is skipped for this path.
 */
export interface StructuredSetInput {
  exercise: string;
  weight_kg: number | null;
  reps: number | null;
}

/**
 * Canonical text for ONE structured set: "Bench Press 80kg x5".
 *
 * Both numbers are optional and mean different things when absent, so neither
 * can be printed as a bare blank:
 *   weight + reps  -> "Bench Press 80kg x5"
 *   weight only    -> "Lat Pulldown 70kg"
 *   reps only      -> "Pull Up bodyweight x8"
 *   neither        -> "Pull Up bodyweight"
 * "bodyweight" rather than an omitted weight, for the same reason
 * formatSetLine says "Bodyweight": no load recorded means the load was the
 * body, and that is a fact rather than a gap.
 */
export function formatStructuredSet(set: StructuredSetInput): string {
  const weight =
    set.weight_kg === null
      ? "bodyweight"
      : `${formatWeightNumber(set.weight_kg)}kg`;
  return set.reps === null
    ? `${set.exercise} ${weight}`
    : `${set.exercise} ${weight} x${set.reps}`;
}

/**
 * raw_input for a structured capture.
 *
 * The column is NOT NULL and is the documented ground truth for what was
 * logged, so a structured row cannot simply leave it empty. It is a faithful
 * echo of the parsed columns rather than something a human typed — which is
 * exactly what makes it safe to synthesize: unlike the free-text path there is
 * no original wording to lose.
 *
 * Server and client both call this so an optimistic row and its saved
 * replacement read identically.
 */
export function formatStructuredRawInput(
  sets: ReadonlyArray<StructuredSetInput>
): string {
  return sets.map(formatStructuredSet).join(", ");
}

/** One exercise's slice of a session draft, with each set's flat-array index. */
export interface StructuredSetGroup {
  exercise: string;
  /** `index` is the set's position in the flat draft — what removal needs. */
  sets: Array<{ set: StructuredSetInput; index: number }>;
}

/**
 * Group a session draft by exercise for display, preserving first-seen order
 * and carrying each set's original index.
 *
 * The flat array stays the source of truth because it IS the request payload,
 * and because set_index is assigned across the whole capture server-side — so
 * the order sets were added in is the order they are stored in. Grouping is
 * presentation only, exactly like groupSetsByExercise above.
 *
 * Re-picking an exercise already in the draft appends to its existing group
 * rather than starting a second one, matching how the display treats a stored
 * capture. Note this means the draft can render a different shape than the
 * saved rows if sets were added out of order — the flat order is what saves.
 */
export function groupStructuredSets(
  sets: ReadonlyArray<StructuredSetInput>
): StructuredSetGroup[] {
  const groups: StructuredSetGroup[] = [];
  const byKey = new Map<string, StructuredSetGroup>();

  sets.forEach((set, index) => {
    const key = exerciseKey(set.exercise);
    let group = byKey.get(key);
    if (!group) {
      group = { exercise: set.exercise, sets: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.sets.push({ set, index });
  });

  return groups;
}

/**
 * That exercise's most recent set, or null. Powers the "Same as last set"
 * shortcut and the prefill when an exercise is picked.
 *
 * Matched on the normalised name so a hand-corrected "bench press" still
 * counts as the same exercise the picker calls "Bench Press" — the same
 * identity groupSetsByExercise uses.
 */
export function lastSetForExercise(
  sets: ReadonlyArray<WorkoutSet>,
  exercise: string
): WorkoutSet | null {
  const key = exerciseKey(exercise);
  let best: WorkoutSet | null = null;
  let bestAt = -Infinity;
  let bestIndex = -1;

  for (const set of sets) {
    if (set.exercise === null || exerciseKey(set.exercise) !== key) continue;
    const at = Date.parse(set.performed_at);
    const index = set.set_index ?? -1;
    if (at > bestAt || (at === bestAt && index > bestIndex)) {
      best = set;
      bestAt = at;
      bestIndex = index;
    }
  }

  return best;
}
