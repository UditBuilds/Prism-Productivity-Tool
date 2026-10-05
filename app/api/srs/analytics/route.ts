import { json } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/select-all";
import { DAY_MS, istDayNumber } from "@/lib/date";
import { computeLearningStreak } from "@/lib/srs/streak";

const WINDOW_DAYS = 30;

export interface DailyActivity {
  date: string; // YYYY-MM-DD (IST civil day)
  count: number;
}

export interface DeckPerformance {
  deckName: string;
  total: number;
  avgEase: number;
  masteryPct: number;
}

export interface AnalyticsData {
  totalReviews: number;
  masteredCount: number;
  needWorkCount: number;
  dailyActivity: DailyActivity[];
  deckPerformance: DeckPerformance[];
  // The four streak fields all come from computeLearningStreak
  // (lib/srs/streak.ts), the same function the Learn page calls.
  /** Freeze-aware consecutive-day review streak (IST). */
  streak: number;
  /** Freezes not yet used in the current IST week. */
  streak_freezes: number;
  /** True when a freeze covers yesterday — drives the "Streak protected" toast. */
  freeze_applied: boolean;
  /** Yesterday's IST date (YYYY-MM-DD) when a freeze covers it, or null. */
  frozen_date: string | null;
}

const isMastered = (easeFactor: number, repetitions: number): boolean =>
  easeFactor >= 2.5 && repetitions >= 3;

const needsWork = (
  easeFactor: number,
  repetitions: number,
  lastReviewed: string | null
): boolean => easeFactor < 1.8 || (repetitions === 0 && lastReviewed !== null);

// GET /api/srs/analytics — learning-curve stats for the authed user.
//
// READ-ONLY. This route used to spend streak freezes by writing to profiles and
// streak_freeze_logs on every GET — and DataPrefetcher calls it on every
// authenticated page load, so the streak moved with how often the app was
// opened. Freezes are now derived from review history alone; nothing here
// writes, and profiles.streak_freezes / freeze_week_start and
// streak_freeze_logs are no longer read.
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  // Fetch ALL review timestamps (an unbounded streak can exceed 30 days; the
  // activity chart below just filters this to its window), the all-time review
  // count, and every card (mastery + per-deck).
  //
  // Reviews and cards are PAGED. An unpaged read silently stops at 1,000 rows,
  // and the reviews query has no ORDER BY, so past that point the streak would
  // be walked over an arbitrary 1,000 of the user's reviews — at 50 reviews a
  // day that is three weeks of use. See lib/supabase/select-all.ts.
  const [reviewsRes, totalRes, cardsRes] = await Promise.all([
    selectAllRows(() => supabase.from("srs_reviews").select("reviewed_at")),
    supabase.from("srs_reviews").select("*", { count: "exact", head: true }),
    selectAllRows(() =>
      supabase
        .from("srs_cards")
        .select("deck_name, ease_factor, repetitions, last_reviewed")
    ),
  ]);

  if (reviewsRes.error)
    return json({ data: null, error: reviewsRes.error.message }, 500);
  if (totalRes.error)
    return json({ data: null, error: totalRes.error.message }, 500);
  if (cardsRes.error)
    return json({ data: null, error: cardsRes.error.message }, 500);

  // One instant for the whole response, so the activity window and the streak
  // can't land on different IST days across midnight.
  const nowMs = Date.now();
  const cards = cardsRes.data ?? [];

  // Mastery / need-work counts.
  let masteredCount = 0;
  let needWorkCount = 0;
  for (const c of cards) {
    if (isMastered(c.ease_factor, c.repetitions)) masteredCount += 1;
    if (needsWork(c.ease_factor, c.repetitions, c.last_reviewed))
      needWorkCount += 1;
  }

  // 30-day activity, bucketed by IST calendar day, gaps filled with 0.
  const todayIdx = istDayNumber(nowMs);
  const startIdx = todayIdx - (WINDOW_DAYS - 1);
  const counts = new Map<number, number>();
  for (const r of reviewsRes.data ?? []) {
    const idx = istDayNumber(Date.parse(r.reviewed_at));
    if (idx >= startIdx && idx <= todayIdx) {
      counts.set(idx, (counts.get(idx) ?? 0) + 1);
    }
  }
  const dailyActivity: DailyActivity[] = [];
  for (let d = startIdx; d <= todayIdx; d++) {
    // new Date(d * DAY_MS) is midnight UTC of epoch-day d, whose UTC date
    // equals the IST civil date for that day index.
    const date = new Date(d * DAY_MS).toISOString().slice(0, 10);
    dailyActivity.push({ date, count: counts.get(d) ?? 0 });
  }

  // Per-deck performance.
  const byDeck = new Map<
    string,
    { total: number; easeSum: number; mastered: number }
  >();
  for (const c of cards) {
    const agg = byDeck.get(c.deck_name) ?? { total: 0, easeSum: 0, mastered: 0 };
    agg.total += 1;
    agg.easeSum += c.ease_factor;
    if (isMastered(c.ease_factor, c.repetitions)) agg.mastered += 1;
    byDeck.set(c.deck_name, agg);
  }
  const deckPerformance: DeckPerformance[] = Array.from(byDeck.entries())
    .map(([deckName, agg]) => ({
      deckName,
      total: agg.total,
      avgEase: Math.round((agg.easeSum / agg.total) * 10) / 10,
      masteryPct: Math.round((agg.mastered / agg.total) * 100),
    }))
    .sort((a, b) => {
      if (a.deckName === "Default") return -1;
      if (b.deckName === "Default") return 1;
      return a.deckName.localeCompare(b.deckName);
    });

  const { streak, freezesLeft, coveredYesterday } = computeLearningStreak(
    (reviewsRes.data ?? []).map((r) => r.reviewed_at),
    nowMs
  );

  return json<AnalyticsData>({
    data: {
      totalReviews: totalRes.count ?? 0,
      masteredCount,
      needWorkCount,
      dailyActivity,
      deckPerformance,
      streak,
      streak_freezes: freezesLeft,
      freeze_applied: coveredYesterday !== null,
      frozen_date: coveredYesterday,
    },
    error: null,
  });
}
