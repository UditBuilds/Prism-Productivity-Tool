import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { istDayContext, istDayNumber, istDateString } from "@/lib/date";
import type { MoodValue } from "@/types/database";

const DAY_MS = 86_400_000;

export interface ReviewDay {
  date: string; // YYYY-MM-DD (IST civil date)
  dayLabel: string; // "Monday" … "Sunday"
  focusMinutes: number;
  tasksDone: number;
  reviewsDone: number;
  mood: MoodValue | null;
  score: number;
  isToday: boolean;
  isFuture: boolean;
}

export interface ReviewDayHighlight {
  date: string;
  dayLabel: string;
  score: number;
  focusMinutes: number;
  tasksDone: number;
  reviewsDone: number;
}

export interface WeeklyReviewData {
  week: { start: string; end: string; label: string };
  summary: {
    focusMinutes: number;
    tasksDone: number;
    reviewsDone: number;
    activeDays: number;
    moodLoggedDays: number;
  };
  days: ReviewDay[];
  bestDay: ReviewDayHighlight | null;
  worstDay: ReviewDayHighlight | null;
  categoryBreakdown: { category: string; minutes: number; percentage: number }[];
  insights: string[];
}

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

const WEEKDAYS = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-06-09" → "9 Jun" (no timezone shifting of the civil date). */
function shortDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${Number.parseInt(d, 10)} ${MONTHS[Number.parseInt(m, 10) - 1]}`;
}

function fmtMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Day score for ranking only (not gamification): focus dominates but is capped
 * so one marathon session can't drown the week; tasks and reviews count
 * moderately. score = min(focus, 180)/10 + tasks*2 + reviews*0.5
 */
function dayScore(focusMinutes: number, tasksDone: number, reviewsDone: number): number {
  return (
    Math.round(
      (Math.min(focusMinutes, 180) / 10 + tasksDone * 2 + reviewsDone * 0.5) * 10
    ) / 10
  );
}

// GET /api/review/weekly?week=current|previous — IST Monday-to-Sunday review
export async function GET(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  const { searchParams } = new URL(request.url);
  const previous = searchParams.get("week") === "previous";

  const { startOfWeek } = istDayContext();
  const weekStartMs = Date.parse(startOfWeek) - (previous ? 7 * DAY_MS : 0);
  const weekEndMs = weekStartMs + 7 * DAY_MS; // exclusive
  const weekStartIdx = istDayNumber(weekStartMs);
  const todayIdx = istDayNumber(Date.now());

  const startIso = new Date(weekStartMs).toISOString();
  const endIso = new Date(weekEndMs).toISOString();
  const dayDates = Array.from({ length: 7 }, (_, i) =>
    istDateString(weekStartMs + i * DAY_MS)
  );

  const [focusRes, tasksRes, reviewsRes, moodRes] = await Promise.all([
    supabase
      .from("focus_sessions")
      .select("started_at, duration_minutes, category, completed")
      .gte("started_at", startIso)
      .lt("started_at", endIso),
    supabase
      .from("tasks")
      .select("updated_at")
      .eq("status", "done")
      .gte("updated_at", startIso)
      .lt("updated_at", endIso),
    supabase
      .from("srs_reviews")
      .select("reviewed_at")
      .gte("reviewed_at", startIso)
      .lt("reviewed_at", endIso),
    supabase
      .from("mood_logs")
      .select("logged_date, mood")
      .gte("logged_date", dayDates[0])
      .lte("logged_date", dayDates[6]),
  ]);

  const firstError =
    focusRes.error ?? tasksRes.error ?? reviewsRes.error ?? moodRes.error;
  if (firstError) return json({ data: null, error: firstError.message }, 500);

  const completedSessions = (focusRes.data ?? []).filter((s) => s.completed);

  // --- Per-day buckets (offset 0–6 within the week) -----------------------
  const focusByDay = new Array<number>(7).fill(0);
  const tasksByDay = new Array<number>(7).fill(0);
  const reviewsByDay = new Array<number>(7).fill(0);
  const moodByDate = new Map<string, MoodValue>(
    (moodRes.data ?? []).map((m) => [m.logged_date, m.mood])
  );

  const offsetOf = (ms: number) => istDayNumber(ms) - weekStartIdx;
  for (const s of completedSessions) {
    const o = offsetOf(Date.parse(s.started_at));
    if (o >= 0 && o < 7) focusByDay[o] += s.duration_minutes;
  }
  for (const t of tasksRes.data ?? []) {
    const o = offsetOf(Date.parse(t.updated_at));
    if (o >= 0 && o < 7) tasksByDay[o] += 1;
  }
  for (const r of reviewsRes.data ?? []) {
    const o = offsetOf(Date.parse(r.reviewed_at));
    if (o >= 0 && o < 7) reviewsByDay[o] += 1;
  }

  const days: ReviewDay[] = dayDates.map((date, i) => {
    const idx = weekStartIdx + i;
    return {
      date,
      dayLabel: WEEKDAYS[i],
      focusMinutes: focusByDay[i],
      tasksDone: tasksByDay[i],
      reviewsDone: reviewsByDay[i],
      mood: moodByDate.get(date) ?? null,
      score: dayScore(focusByDay[i], tasksByDay[i], reviewsByDay[i]),
      isToday: idx === todayIdx,
      isFuture: idx > todayIdx,
    };
  });

  // --- Summary -------------------------------------------------------------
  const summary = {
    focusMinutes: focusByDay.reduce((a, b) => a + b, 0),
    tasksDone: tasksByDay.reduce((a, b) => a + b, 0),
    reviewsDone: reviewsByDay.reduce((a, b) => a + b, 0),
    activeDays: days.filter((d) => d.score > 0).length,
    moodLoggedDays: days.filter((d) => d.mood !== null).length,
  };

  // --- Best / quietest day --------------------------------------------------
  const activeDays = days.filter((d) => d.score > 0 && !d.isFuture);
  const toHighlight = (d: ReviewDay): ReviewDayHighlight => ({
    date: d.date,
    dayLabel: d.dayLabel,
    score: d.score,
    focusMinutes: d.focusMinutes,
    tasksDone: d.tasksDone,
    reviewsDone: d.reviewsDone,
  });

  let bestDay: ReviewDayHighlight | null = null;
  let worstDay: ReviewDayHighlight | null = null;
  if (activeDays.length > 0) {
    const sorted = [...activeDays].sort((a, b) => b.score - a.score);
    bestDay = toHighlight(sorted[0]);
    // A "quietest day" only means something with 2+ active days to compare.
    if (sorted.length >= 2) {
      worstDay = toHighlight(sorted[sorted.length - 1]);
    }
  }

  // --- Category breakdown ----------------------------------------------------
  const byCategory = new Map<string, number>();
  for (const s of completedSessions) {
    byCategory.set(
      s.category,
      (byCategory.get(s.category) ?? 0) + s.duration_minutes
    );
  }
  const categoryBreakdown = Array.from(byCategory.entries())
    .map(([category, minutes]) => ({
      category,
      minutes,
      percentage:
        summary.focusMinutes > 0
          ? Math.round((minutes / summary.focusMinutes) * 100)
          : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);

  // --- Deterministic insights (2–4, data only) -------------------------------
  const elapsedDays = previous
    ? 7
    : Math.min(7, Math.max(1, todayIdx - weekStartIdx + 1));
  const insights: string[] = [];

  if (bestDay) {
    const parts: string[] = [];
    if (bestDay.focusMinutes > 0)
      parts.push(`${fmtMinutes(bestDay.focusMinutes)} of focus`);
    if (bestDay.tasksDone > 0)
      parts.push(`${bestDay.tasksDone} task${bestDay.tasksDone === 1 ? "" : "s"} done`);
    if (bestDay.reviewsDone > 0)
      parts.push(`${bestDay.reviewsDone} reviews`);
    insights.push(
      `${bestDay.dayLabel} was your strongest day — ${parts.join(", ")}.`
    );
  }
  if (categoryBreakdown.length > 0 && categoryBreakdown[0].percentage >= 40) {
    insights.push(
      `Most of your focus went to ${categoryBreakdown[0].category} (${categoryBreakdown[0].percentage}%).`
    );
  }
  if (summary.activeDays > 0) {
    insights.push(
      previous
        ? `You were active on ${summary.activeDays} of 7 days.`
        : `Active on ${summary.activeDays} of ${elapsedDays} day${elapsedDays === 1 ? "" : "s"} so far.`
    );
  }
  if (elapsedDays >= 3) {
    if (summary.moodLoggedDays === elapsedDays) {
      insights.push("You checked in your mood every day. ");
    } else if (summary.moodLoggedDays <= elapsedDays - 3) {
      insights.push(
        `Mood was logged on ${summary.moodLoggedDays} of ${elapsedDays} days.`
      );
    }
  }

  const data: WeeklyReviewData = {
    week: {
      start: dayDates[0],
      end: dayDates[6],
      label: `${shortDate(dayDates[0])} – ${shortDate(dayDates[6])}`,
    },
    summary,
    days,
    bestDay,
    worstDay,
    categoryBreakdown,
    insights: insights.slice(0, 4).map((s) => s.trim()),
  };
  return json<WeeklyReviewData>({ data, error: null });
}
