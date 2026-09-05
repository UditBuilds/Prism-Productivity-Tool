import { istDateString } from "@/lib/date";
import {
  BODY_PARTS,
  UNCLASSIFIED_BODY_PART,
  bodyPartForExercise,
} from "@/lib/exercise-library";
import { exerciseKey } from "@/lib/workouts";
import type { WorkoutSet } from "@/types/database";

/**
 * Progressive overload and body-part balance, derived from workout_sets alone.
 *
 * NOTHING HERE NEEDS A SCHEMA CHANGE, and one decision is why: progression is
 * measured on the TOP SET of a session — the heaviest weight logged for that
 * exercise that day — not on total volume and not on a per-set classification.
 *
 * The top set is warmup-immune by construction. The one real ramp in the table
 * (Flat Bench Press, 60kg×15 → 80kg×6 → 90kg×2, raw_input "Flat bench 3 sets
 * (pr 90kg)") reduces to 90kg, correctly discarding the 60kg opener; a flat
 * 70/70/70 capture reduces to 70kg, also correctly. A `set_type` column would
 * let the same two captures be labelled explicitly, but `max` already gets both
 * right, so the column would carry no decision. Revisit only if drop sets
 * appear — a DESCENDING run after a top set is the shape `max` would mis-read,
 * and no capture currently has one.
 *
 * VOLUME IS DELIBERATELY NOT THE METRIC. Volume needs weight AND reps, and 12
 * of the 15 real rows have no reps at all — only Flat Bench Press could produce
 * a volume figure. A volume-first design would blank four of five exercises
 * while looking like it was working. Hence the fallback ladder in
 * `compareSessions`: weight where weight exists, reps where it doesn't, set
 * count where neither does. Every real exercise lands on a rung.
 */

/** Which number a comparison is actually made of. */
export type ProgressBasis = "weight" | "reps" | "sets";

export type ProgressDirection = "up" | "down" | "same";

/** One exercise's work on one IST day. */
export interface ExerciseSession {
  /** IST civil date, "YYYY-MM-DD". */
  date: string;
  /** Heaviest weight that day, or null when nothing was weighted. */
  topWeightKg: number | null;
  /** Best reps achieved AT `topWeightKg` — what "90 kg × 2" prints. */
  topSetReps: number | null;
  /** Highest reps that day at any weight. The bodyweight-progression rung. */
  topReps: number | null;
  /** Sets logged that day. The last rung, for work with no numbers at all. */
  sets: number;
}

export interface ProgressChange {
  basis: ProgressBasis;
  /** Current minus previous, in the basis's own unit. */
  delta: number;
  direction: ProgressDirection;
  /** The session being compared against. */
  from: ExerciseSession;
}

export interface ExerciseProgression {
  /** Normalised identity — stable React key. */
  key: string;
  /** Display name: the user's most recent spelling. */
  exercise: string;
  /** null when the library doesn't know this name. */
  bodyPart: string | null;
  /** Chronological, one entry per IST day trained. */
  sessions: ExerciseSession[];
  latest: ExerciseSession;
  /**
   * null when this exercise has been logged on only ONE day — the current
   * state of every exercise in the table. The UI must render that case as a
   * baseline, not as a zero change.
   */
  change: ProgressChange | null;
  /** Heaviest top set ever recorded, across all sessions in the window. */
  bestWeightKg: number | null;
}

export interface BodyPartLoad {
  bodyPart: string;
  sets: number;
  /** Distinct exercises trained for this part. */
  exercises: number;
  /** IST date last trained, or null if never in the window. */
  lastTrained: string | null;
  /** Whole IST days since `lastTrained`; null when never trained. */
  daysSince: number | null;
  /** Share of all classified sets, 0..1. */
  share: number;
}

export interface WorkoutAnalysis {
  windowDays: number;
  totalSets: number;
  /** Distinct IST days with any set. */
  sessionDays: number;
  firstSessionDate: string | null;
  lastSessionDate: string | null;
  /** Rows that never parsed — counted so they are never silently dropped. */
  unparsedSets: number;
  /**
   * Exercises logged on 2+ days, i.e. how much of the progression view can
   * actually show movement. Currently 0 on the real table.
   */
  comparableExercises: number;
  progressions: ExerciseProgression[];
  bodyParts: BodyPartLoad[];
}

const DAY_MS = 86_400_000;

/**
 * Whole days between two IST civil dates.
 *
 * Both arguments are already IST-resolved "YYYY-MM-DD" strings, so this is
 * calendar arithmetic with no timezone left in it: parsing the components into
 * Date.UTC keeps it that way. `new Date("2026-08-04") - new Date(...)` would
 * work too, but only by accident of both sides shifting equally — this is the
 * same result without depending on that.
 */
function civilDaysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS
  );
}

function maxOrNull(values: Array<number | null>): number | null {
  let best: number | null = null;
  for (const v of values) {
    if (v === null) continue;
    if (best === null || v > best) best = v;
  }
  return best;
}

/** Collapse one exercise's sets on one day into a single comparable point. */
function toSession(date: string, sets: WorkoutSet[]): ExerciseSession {
  const topWeightKg = maxOrNull(sets.map((s) => s.weight_kg));
  // Reps AT the top weight, not the day's best reps — "90 kg × 2" has to be a
  // set that actually happened. A 60kg×15 opener must not lend its 15 to the
  // 90kg single.
  const topSetReps =
    topWeightKg === null
      ? null
      : maxOrNull(
          sets.filter((s) => s.weight_kg === topWeightKg).map((s) => s.reps)
        );

  return {
    date,
    topWeightKg,
    topSetReps,
    topReps: maxOrNull(sets.map((s) => s.reps)),
    sets: sets.length,
  };
}

/**
 * Compare two sessions on the best basis BOTH of them support.
 *
 * The basis must be common to the pair, not picked from the newer session
 * alone: if last week was logged bodyweight-only and today carries weight,
 * there is no weight to compare against, and quietly reporting "+90 kg" would
 * invent a gain out of a change in logging habit.
 */
export function compareSessions(
  from: ExerciseSession,
  to: ExerciseSession
): ProgressChange {
  let basis: ProgressBasis;
  let delta: number;

  if (from.topWeightKg !== null && to.topWeightKg !== null) {
    basis = "weight";
    delta = to.topWeightKg - from.topWeightKg;
  } else if (from.topReps !== null && to.topReps !== null) {
    basis = "reps";
    delta = to.topReps - from.topReps;
  } else {
    basis = "sets";
    delta = to.sets - from.sets;
  }

  return {
    basis,
    delta,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "same",
    from,
  };
}

/**
 * Build the whole analysis from a window of sets.
 *
 * `today` is injected rather than read from the clock so the day-difference
 * arithmetic is testable and so the server's IST day is the one used, not the
 * browser's.
 */
export function analyseWorkoutSets(
  sets: ReadonlyArray<WorkoutSet>,
  windowDays: number,
  today: string = istDateString()
): WorkoutAnalysis {
  const parsed = sets.filter(
    (s) => typeof s.exercise === "string" && s.exercise.trim() !== ""
  );

  const sessionDates: Record<string, true> = {};
  for (const set of sets) {
    sessionDates[istDateString(Date.parse(set.performed_at))] = true;
  }
  const allDates = Object.keys(sessionDates).sort();

  // ---- per exercise, per day -------------------------------------------
  interface Bucket {
    key: string;
    /** Latest spelling seen wins, matching the picker's own preference. */
    exercise: string;
    latestAt: number;
    byDate: Record<string, WorkoutSet[]>;
  }
  const buckets: Record<string, Bucket> = {};

  for (const set of parsed) {
    const name = (set.exercise as string).trim();
    const key = exerciseKey(name);
    const at = Date.parse(set.performed_at);
    let bucket = buckets[key];
    if (!bucket) {
      bucket = { key, exercise: name, latestAt: at, byDate: {} };
      buckets[key] = bucket;
    } else if (at >= bucket.latestAt) {
      bucket.latestAt = at;
      bucket.exercise = name;
    }
    const date = istDateString(at);
    (bucket.byDate[date] ??= []).push(set);
  }

  const progressions: ExerciseProgression[] = Object.keys(buckets).map((key) => {
    const bucket = buckets[key];
    const sessions = Object.keys(bucket.byDate)
      .sort()
      .map((date) => toSession(date, bucket.byDate[date]));
    const latest = sessions[sessions.length - 1];
    const previous = sessions.length > 1 ? sessions[sessions.length - 2] : null;

    return {
      key,
      exercise: bucket.exercise,
      bodyPart: bodyPartForExercise(bucket.exercise),
      sessions,
      latest,
      change: previous ? compareSessions(previous, latest) : null,
      bestWeightKg: maxOrNull(sessions.map((s) => s.topWeightKg)),
    };
  });

  /**
   * Rows that can show movement lead, then most recent first.
   *
   * The first key is a no-op today — nothing has two sessions — so the list
   * currently reads as pure recency. It earns its place the moment one
   * exercise is repeated: the row that finally has something to say about
   * overload rises to the top instead of sitting wherever recency left it.
   */
  progressions.sort((a, b) => {
    const aCmp = a.change ? 0 : 1;
    const bCmp = b.change ? 0 : 1;
    if (aCmp !== bCmp) return aCmp - bCmp;
    if (a.latest.date !== b.latest.date) {
      return a.latest.date < b.latest.date ? 1 : -1;
    }
    return a.exercise.localeCompare(b.exercise);
  });

  // ---- body-part balance ------------------------------------------------
  interface PartAcc {
    sets: number;
    exercises: Record<string, true>;
    lastTrained: string | null;
  }
  const acc: Record<string, PartAcc> = {};
  const ensure = (part: string): PartAcc =>
    (acc[part] ??= { sets: 0, exercises: {}, lastTrained: null });

  // Every library group is seeded, so a part with no sets still appears. A
  // zero here IS the finding — dropping empty rows would hide exactly the
  // muscle groups the feature exists to surface.
  for (const part of BODY_PARTS) ensure(part);

  for (const set of parsed) {
    const part =
      bodyPartForExercise(set.exercise) ?? UNCLASSIFIED_BODY_PART;
    const entry = ensure(part);
    entry.sets += 1;
    entry.exercises[exerciseKey(set.exercise as string)] = true;
    const date = istDateString(Date.parse(set.performed_at));
    if (entry.lastTrained === null || date > entry.lastTrained) {
      entry.lastTrained = date;
    }
  }

  const classifiedSets = Object.keys(acc).reduce((n, p) => n + acc[p].sets, 0);

  const bodyParts: BodyPartLoad[] = Object.keys(acc)
    // "Other" is seeded only by real unclassified work, so it appears only
    // when it has some — unlike the six library groups, an empty "Other" is
    // not a finding, it is just noise.
    .filter((part) => acc[part].sets > 0 || BODY_PARTS.indexOf(part) !== -1)
    .map((part) => {
      const entry = acc[part];
      return {
        bodyPart: part,
        sets: entry.sets,
        exercises: Object.keys(entry.exercises).length,
        lastTrained: entry.lastTrained,
        daysSince:
          entry.lastTrained === null
            ? null
            : civilDaysBetween(entry.lastTrained, today),
        share: classifiedSets === 0 ? 0 : entry.sets / classifiedSets,
      };
    });

  /**
   * Most neglected first: never-trained, then longest-untrained, then least
   * work. This is the ranking the feature is named for, so it is the storage
   * order — the UI does not re-sort.
   */
  bodyParts.sort((a, b) => {
    const aNever = a.lastTrained === null ? 0 : 1;
    const bNever = b.lastTrained === null ? 0 : 1;
    if (aNever !== bNever) return aNever - bNever;
    if (a.daysSince !== b.daysSince) {
      return (b.daysSince ?? 0) - (a.daysSince ?? 0);
    }
    if (a.sets !== b.sets) return a.sets - b.sets;
    return BODY_PARTS.indexOf(a.bodyPart) - BODY_PARTS.indexOf(b.bodyPart);
  });

  return {
    windowDays,
    totalSets: sets.length,
    sessionDays: allDates.length,
    firstSessionDate: allDates[0] ?? null,
    lastSessionDate: allDates[allDates.length - 1] ?? null,
    unparsedSets: sets.length - parsed.length,
    comparableExercises: progressions.filter((p) => p.sessions.length > 1)
      .length,
    progressions,
    bodyParts,
  };
}

/** "90 kg × 2" / "70 kg" / "3 sets" — whatever the session actually has. */
export function formatSessionTopSet(session: ExerciseSession): string {
  if (session.topWeightKg !== null) {
    const weight = `${Number(session.topWeightKg)
      .toFixed(2)
      .replace(/\.?0+$/, "")} kg`;
    return session.topSetReps === null
      ? weight
      : `${weight} × ${session.topSetReps}`;
  }
  if (session.topReps !== null) return `Bodyweight × ${session.topReps}`;
  return `${session.sets} set${session.sets === 1 ? "" : "s"}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * "11 Aug" from an IST civil "YYYY-MM-DD".
 *
 * Split-and-index rather than `new Date(str)` + date-fns, for the reason
 * CLAUDE.md records against the analytics chart axis: parsing a bare civil
 * date yields UTC midnight, which formats as the PREVIOUS day for any viewer
 * behind UTC. The string already names the day — there is nothing to convert.
 */
export function formatCivilDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/**
 * Only the body parts with nothing logged in the window.
 *
 * The dashboard's Training panel used to render all seven groups. Everything
 * trained recently is information the user already has — he was there — so the
 * only cell carrying a decision is the one that says a group is owed work.
 * Six of the seven cells were a receipt.
 *
 * A SELECTOR, NOT A NEW SHAPE. `analyseWorkoutSets` still seeds and returns
 * every group, because the workout page ranks the full balance and the
 * `share` figures are computed against all of them. This is the dashboard's
 * view of that same data, kept here rather than inline in the component so it
 * can be tested without a renderer.
 *
 * Returns them in the endpoint's own order, which for untrained groups is
 * already the ranking this feature is named for (never-trained first, then
 * library order) — there is nothing left to re-sort once the trained half is
 * gone, which is exactly why the panel's trained-first re-ordering goes away
 * with it.
 *
 * NOTE ON WHAT "UNTRAINED" CAN MEAN. A group lands here when no set in the
 * window mapped to it, and mapping is an EXACT match on `exerciseKey` against
 * the static library — so an exercise the library does not know is counted
 * under `UNCLASSIFIED_BODY_PART` ("Other") rather than under the group it
 * actually trains. On the live table that is currently why Shoulders and Core
 * read as untrained: "Lateral Raise Drop Set" and "Crunch" are both unmapped.
 * That is a mapping defect, tracked separately and deliberately not fixed
 * here; this selector reports what the analysis says, faithfully.
 */
export function untrainedBodyParts(
  bodyParts: ReadonlyArray<BodyPartLoad>
): BodyPartLoad[] {
  return bodyParts.filter((b) => b.daysSince === null);
}

/** "Today" / "Yesterday" / "11 days ago" — for a `daysSince` count. */
export function formatDaysSince(days: number): string {
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

/** "+5 kg" / "−1 rep" / "Same weight" — signed, in the basis's own unit. */
export function formatChange(change: ProgressChange): string {
  const unit =
    change.basis === "weight"
      ? "kg"
      : change.basis === "reps"
        ? Math.abs(change.delta) === 1
          ? "rep"
          : "reps"
        : Math.abs(change.delta) === 1
          ? "set"
          : "sets";

  if (change.delta === 0) {
    const noun =
      change.basis === "weight"
        ? "weight"
        : change.basis === "reps"
          ? "reps"
          : "sets";
    return `Same ${noun}`;
  }
  // U+2212 minus, not a hyphen: this sits beside "+5 kg" in tabular mono and a
  // hyphen renders visibly shorter and higher than the plus it pairs with.
  const sign = change.delta > 0 ? "+" : "−";
  return `${sign}${Math.abs(change.delta)} ${unit}`;
}
