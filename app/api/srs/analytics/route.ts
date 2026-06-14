import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { istDayContext, istDayNumber, istDateString } from "@/lib/date";

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
  /** Freeze-aware consecutive-day review streak (IST). */
  streak: number;
  /** Freezes remaining this IST week (after any consumed this call). */
  streak_freezes: number;
  /** True if a freeze was auto-applied on this request. */
  freeze_applied: boolean;
  /** The IST date (YYYY-MM-DD) a freeze covered this call, or null. */
  frozen_date: string | null;
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

  // Fetch ALL review timestamps (an unbounded streak can exceed 30 days; the
  // activity chart below just filters this to its window), the all-time review
  // count, every card (mastery + per-deck), plus the profile + freeze logs.
  const [reviewsRes, totalRes, cardsRes, profileRes, freezeLogsRes] =
    await Promise.all([
      supabase.from("srs_reviews").select("reviewed_at"),
      supabase.from("srs_reviews").select("*", { count: "exact", head: true }),
      supabase
        .from("srs_cards")
        .select("deck_name, ease_factor, repetitions, last_reviewed"),
      supabase
        .from("profiles")
        .select("streak_freezes, freeze_week_start")
        .eq("id", user.id)
        .single(),
      supabase
        .from("streak_freeze_logs")
        .select("frozen_date")
        .eq("user_id", user.id),
    ]);

  if (reviewsRes.error)
    return json({ data: null, error: reviewsRes.error.message }, 500);
  if (totalRes.error)
    return json({ data: null, error: totalRes.error.message }, 500);
  if (cardsRes.error)
    return json({ data: null, error: cardsRes.error.message }, 500);
  // profile / freeze-log read failures degrade gracefully (no early return).

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

  // ---- Streak + auto-applied freeze protection -------------------------
  const reviewDates = new Set<string>();
  for (const r of reviewsRes.data ?? []) {
    reviewDates.add(istDateString(Date.parse(r.reviewed_at)));
  }
  const todayStr = istDateString(Date.now());

  const profile = profileRes.data;
  const profileOk = !!profile && !profileRes.error && !freezeLogsRes.error;
  const frozenDates = new Set<string>(
    (freezeLogsRes.data ?? []).map((f) => f.frozen_date)
  );

  // availableFreezes = how many the walk may spend; responseFreezes = what we
  // return to the client (a graceful 3 when the profile can't be read, so the
  // UI badge stays quiet rather than alarming with a wrong "0").
  let availableFreezes = 0;
  let responseFreezes = 3;
  if (profileOk && profile) {
    // Step B: replenish to 3 at the start of each IST week (Monday).
    const currentMonday = istDateString(
      Date.parse(istDayContext().startOfWeek)
    );
    if (profile.freeze_week_start < currentMonday) {
      await supabase
        .from("profiles")
        .update({ streak_freezes: 3, freeze_week_start: currentMonday })
        .eq("id", user.id);
      availableFreezes = 3;
    } else {
      availableFreezes = profile.streak_freezes;
    }
    responseFreezes = availableFreezes;
  } else {
    // No usable profile/logs → ignore freezes entirely for the streak walk.
    frozenDates.clear();
  }

  // Step C: walk backwards from the anchor, spending at most one freeze.
  const isActive = (d: string) => reviewDates.has(d) || frozenDates.has(d);
  let streak = 0;
  let freezeToApply: string | null = null;
  let freezeUsed = false;
  let curIdx = reviewDates.has(todayStr) ? todayIdx : todayIdx - 1;
  while (true) {
    const dateStr = istDateString(curIdx * DAY_MS);
    if (isActive(dateStr)) {
      streak += 1;
      curIdx -= 1;
      continue;
    }
    if (
      !freezeUsed &&
      availableFreezes > 0 &&
      dateStr !== todayStr &&
      streak > 0
    ) {
      freezeToApply = dateStr;
      freezeUsed = true;
      streak += 1;
      curIdx -= 1;
      continue;
    }
    break;
  }

  // Step D: persist a newly-applied freeze — separate INSERT then UPDATE.
  let freezeApplied = false;
  let frozenDate: string | null = null;
  if (freezeToApply && profileOk) {
    const { data: insertedLog } = await supabase
      .from("streak_freeze_logs")
      .upsert(
        { user_id: user.id, frozen_date: freezeToApply },
        { onConflict: "user_id,frozen_date", ignoreDuplicates: true }
      )
      .select("id");
    // Decrement only when THIS call actually inserted the freeze — guards a
    // concurrent duplicate request from double-spending a freeze.
    if (insertedLog && insertedLog.length > 0) {
      await supabase
        .from("profiles")
        .update({ streak_freezes: responseFreezes - 1 })
        .eq("id", user.id);
      responseFreezes -= 1;
      freezeApplied = true;
      frozenDate = freezeToApply;
    }
  }

  return json<AnalyticsData>({
    data: {
      totalReviews: totalRes.count ?? 0,
      masteredCount,
      needWorkCount,
      dailyActivity,
      deckPerformance,
      streak,
      streak_freezes: responseFreezes,
      freeze_applied: freezeApplied,
      frozen_date: frozenDate,
    },
    error: null,
  });
}
