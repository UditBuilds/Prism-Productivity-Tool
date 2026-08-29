import { istDateString } from "@/lib/date";
import {
  UNCLASSIFIED_BODY_PART,
  bodyPartForExercise,
} from "@/lib/exercise-library";
import type { StructuredSetInput } from "@/lib/workouts";
import type { WorkoutSet } from "@/types/database";

/**
 * "Repeat last Legs day" — one past session, ready to re-log.
 *
 * WHY THIS FILE EXISTS RATHER THAN lib/workouts.ts. It needs
 * bodyPartForExercise, and lib/exercise-library imports exerciseKey FROM
 * lib/workouts — so putting it there would invert that dependency and drag all
 * 66 library names into every chunk that merely groups sets. CLAUDE.md records
 * that exact regression (a "Barbell Bench Press" string found in the built
 * /dashboard chunk) as the reason exerciseKey was moved out of the library in
 * the first place. This module sits downstream of both, and only the Workout
 * page imports it — a page that already loads the library for its picker.
 */
export interface RepeatableSession {
  /** Dominant body part — the label on the chip. */
  bodyPart: string;
  /** IST civil day, "YYYY-MM-DD". */
  date: string;
  /** Every parsed set from that day, in logged order, ready to re-submit. */
  sets: StructuredSetInput[];
  /** Distinct exercises in the session — for the chip's sub-label. */
  exerciseCount: number;
}

/**
 * A SESSION IS AN IST DAY, NOT A CAPTURE. The real table's 2026-08-20 Legs
 * session arrived as three separate captures (1 set, 1 set, then 8) because
 * the user logged as they lifted. Keyed by capture that would have offered
 * three "sessions" to repeat, two of them a single set — which is not what
 * anyone means by "last Legs day". Keyed by day it is one 10-set session, and
 * it matches how every other surface in this app buckets workout history.
 */
function istDayOf(set: WorkoutSet): string {
  return istDateString(Date.parse(set.performed_at));
}

/**
 * The most recent session for each body part the user has actually trained,
 * most recent first.
 *
 * A session's body part is whichever part has the MOST SETS that day, using
 * the same bodyPartForExercise() mapping Progress and Balance already read —
 * no new column, no second source of truth about what trains what.
 *
 * TIE RULE: the body part whose set appears FIRST in that day's rows wins.
 * Deliberately simple, and measured before it was chosen — across the real
 * table's 4 session days and 9 captures there is not one tie, so this branch
 * has no effect on any data that exists. It is a determinism guarantee, not a
 * judgement call: without it a 50/50 push-pull day would label itself
 * differently depending on object key order.
 *
 * ONE CHIP PER BODY PART. A part trained five times contributes its LATEST
 * session only — "repeat last Legs day" has exactly one meaning.
 *
 * Unparsed rows (exercise null, the free-text fallback's failure mode) are
 * excluded, matching analyseWorkoutSets. They carry no exercise name, so they
 * can neither vote for a body part nor be reproduced as a set; a day that is
 * entirely unparsed yields no session, which is correct — there is nothing
 * there to repeat.
 */
export function repeatableSessions(
  sets: ReadonlyArray<WorkoutSet>
): RepeatableSession[] {
  const parsed = sets.filter(
    (s) => typeof s.exercise === "string" && s.exercise.trim() !== ""
  );

  // Sorted rather than trusting the caller: GET /api/workouts returns
  // performed_at ASC, but the ["workouts"] cache also carries optimistic rows
  // appended at the end, so neither end of the array is reliably ordered.
  // Same defence recentExercises() takes against the same cache.
  const ordered = parsed.slice().sort((a, b) => {
    const at = Date.parse(a.performed_at);
    const bt = Date.parse(b.performed_at);
    if (at !== bt) return at - bt;
    return (a.set_index ?? 0) - (b.set_index ?? 0);
  });

  const byDay: Record<string, WorkoutSet[]> = {};
  const dayOrder: string[] = [];
  for (const set of ordered) {
    const day = istDayOf(set);
    if (!byDay[day]) {
      byDay[day] = [];
      dayOrder.push(day);
    }
    byDay[day].push(set);
  }

  // Latest day per body part. Days are walked oldest-first, so a later day
  // simply overwrites an earlier one for the same part.
  const latest: Record<string, RepeatableSession> = {};

  for (const day of dayOrder) {
    const rows = byDay[day];

    const counts: Record<string, number> = {};
    // First appearance order, which IS the tie-break.
    const seenOrder: string[] = [];
    for (const set of rows) {
      const part =
        bodyPartForExercise(set.exercise) ?? UNCLASSIFIED_BODY_PART;
      if (counts[part] === undefined) {
        counts[part] = 0;
        seenOrder.push(part);
      }
      counts[part] += 1;
    }

    let dominant = seenOrder[0];
    for (const part of seenOrder) {
      // Strictly greater, so the earliest-seen part keeps the win on a tie.
      if (counts[part] > counts[dominant]) dominant = part;
    }

    const exercises: string[] = [];
    const sessionSets: StructuredSetInput[] = rows.map((set) => {
      const name = (set.exercise as string).trim();
      if (exercises.indexOf(name) === -1) exercises.push(name);
      return {
        exercise: name,
        // Copied EXACTLY. Suggesting a heavier next set is a different
        // feature, and one nobody asked for — the app does not know whether
        // last session was a peak, a deload or an injury.
        weight_kg: set.weight_kg,
        reps: set.reps,
      };
    });

    latest[dominant] = {
      bodyPart: dominant,
      date: day,
      sets: sessionSets,
      exerciseCount: exercises.length,
    };
  }

  return Object.keys(latest)
    .map((part) => latest[part])
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
