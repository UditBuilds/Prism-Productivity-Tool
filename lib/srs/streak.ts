import { DAY_MS, istDateString, istDayNumber, istWeekday } from "@/lib/date";

/** Missed days a freeze may cover in one IST week (Monday–Sunday). */
export const FREEZES_PER_WEEK = 3;

export interface LearningStreak {
  /** Consecutive active-or-covered IST days, counted back from the anchor. */
  streak: number;
  /** FREEZES_PER_WEEK minus the covered days already in the current IST week. */
  freezesLeft: number;
  /** Yesterday's IST date ("YYYY-MM-DD") when a freeze covers it, else null. */
  coveredYesterday: string | null;
}

/**
 * The learning streak, worked out from review history and the current instant
 * ONLY. Pure: it reads no clock and touches no database, so the same reviews
 * and the same `nowMs` give the same answer however often it is called. The
 * Learn page and GET /api/srs/analytics both call this, so the two can't
 * disagree, and nothing is ever written to "spend" a freeze.
 *
 * Every day below is an IST civil day:
 *
 * - ACTIVE: a day with at least one review.
 * - CANDIDATE: a day before today with no review whose previous day is
 *   ACTIVE. A covered day doesn't count as that previous day, so two missed
 *   days in a row always break the streak. Today is never missed while it is
 *   still today.
 * - COVERED: a candidate that is one of the first FREEZES_PER_WEEK candidates
 *   of its own Monday–Sunday week, counted in date order. The week is the
 *   week of the missed day itself, not of the day the user came back.
 *   Candidates can never be adjacent (a candidate's previous day is active),
 *   so a week holds at most four — only a missed Sunday after a missed
 *   Monday, Wednesday and Friday can be refused.
 * - STREAK: start at today if today is active, otherwise at yesterday, and
 *   count active or covered days back to the first day that is neither. A
 *   missed yesterday is covered before today's first review, so the streak
 *   stays alive all day instead of reading 0 until the user reviews.
 */
export function computeLearningStreak(
  reviewedAt: readonly string[],
  nowMs: number
): LearningStreak {
  const active = new Set<number>();
  for (const iso of reviewedAt) {
    const ms = Date.parse(iso);
    if (Number.isFinite(ms)) active.add(istDayNumber(ms));
  }
  const today = istDayNumber(nowMs);

  const isCandidate = (day: number): boolean =>
    day < today && !active.has(day) && active.has(day - 1);

  // An IST day index times DAY_MS is 05:30 IST on that same civil day.
  const mondayOf = (day: number): number =>
    day - ((istWeekday(day * DAY_MS) + 6) % 7);

  const isCovered = (day: number): boolean => {
    if (!isCandidate(day)) return false;
    let earlier = 0;
    for (let d = mondayOf(day); d < day; d++) {
      if (isCandidate(d)) earlier += 1;
    }
    return earlier < FREEZES_PER_WEEK;
  };

  let cursor = active.has(today) ? today : today - 1;
  let streak = 0;
  while (active.has(cursor) || isCovered(cursor)) {
    streak += 1;
    cursor -= 1;
  }

  let usedThisWeek = 0;
  for (let d = mondayOf(today); d < today; d++) {
    if (isCovered(d)) usedThisWeek += 1;
  }

  return {
    streak,
    freezesLeft: FREEZES_PER_WEEK - usedThisWeek,
    coveredYesterday: isCovered(today - 1)
      ? istDateString((today - 1) * DAY_MS)
      : null,
  };
}
