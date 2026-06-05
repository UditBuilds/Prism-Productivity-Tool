import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { istDayNumber } from "@/lib/date";

const DAY_MS = 86_400_000;
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
}

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

const isMastered = (easeFactor: number, repetitions: number): boolean =>
  easeFactor >= 2.5 && repetitions >= 3;

const needsWork = (
  easeFactor: number,
  repetitions: number,
  lastReviewed: string | null
): boolean => easeFactor < 1.8 || (repetitions === 0 && lastReviewed !== null);

// GET /api/srs/analytics — learning-curve stats for the authed user
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  // Fetch the last ~31 days of reviews (covers all 30 IST days), the all-time
  // review count, and every card (for mastery + per-deck performance).
  const sinceIso = new Date(Date.now() - (WINDOW_DAYS + 1) * DAY_MS).toISOString();
  const [reviewsRes, totalRes, cardsRes] = await Promise.all([
    supabase.from("srs_reviews").select("reviewed_at").gte("reviewed_at", sinceIso),
    supabase
      .from("srs_reviews")
      .select("*", { count: "exact", head: true }),
    supabase
      .from("srs_cards")
      .select("deck_name, ease_factor, repetitions, last_reviewed"),
  ]);

  if (reviewsRes.error)
    return json({ data: null, error: reviewsRes.error.message }, 500);
  if (totalRes.error)
    return json({ data: null, error: totalRes.error.message }, 500);
  if (cardsRes.error)
    return json({ data: null, error: cardsRes.error.message }, 500);

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
  const todayIdx = istDayNumber(Date.now());
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

  return json<AnalyticsData>({
    data: {
      totalReviews: totalRes.count ?? 0,
      masteredCount,
      needWorkCount,
      dailyActivity,
      deckPerformance,
    },
    error: null,
  });
}
