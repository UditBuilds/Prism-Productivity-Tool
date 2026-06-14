import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  istDayContext,
  istDayNumber,
  istDateString,
  istHour,
} from "@/lib/date";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;
/** Minimum completed sessions before "peak hour / best day" insights are real. */
const MIN_SESSIONS_FOR_INSIGHTS = 3;

export interface WeekStats {
  focusMinutes: number;
  tasksCompleted: number;
  reviewsDone: number;
  activeDays: number;
}

export interface CategorySlice {
  category: string;
  totalMinutes: number;
  sessions: number;
  percentage: number;
}

export interface ProductivityData {
  dailyFocus: { date: string; minutes: number }[];
  dailyTasks: { date: string; count: number }[];
  categoryBreakdown: CategorySlice[];
  thisWeek: WeekStats;
  lastWeek: WeekStats;
  /** All figures below are scoped to the last 30 days. */
  totalFocusHours: number;
  totalTasksCompleted: number;
  totalSessions: number;
  mostProductiveHour: number | null;
  mostProductiveDay: string | null;
}

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

const weekdayName = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  timeZone: "Asia/Kolkata",
});

// GET /api/analytics/productivity — focus/tasks/reviews trends (last 30 IST days)
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  const { startOfToday, startOfWeek } = istDayContext();
  const startOfTodayMs = Date.parse(startOfToday);
  const todayIdx = istDayNumber(Date.now());
  const windowStartIdx = todayIdx - (WINDOW_DAYS - 1);
  const windowStartIso = new Date(
    startOfTodayMs - (WINDOW_DAYS - 1) * DAY_MS
  ).toISOString();

  // Completed tasks are bucketed by completed_at (status='done', completed_at
  // not null) — set when a task is marked done, preserved across later edits.
  const [focusRes, tasksRes, reviewsRes] = await Promise.all([
    supabase
      .from("focus_sessions")
      .select("started_at, duration_minutes, category, completed")
      .gte("started_at", windowStartIso),
    supabase
      .from("tasks")
      .select("completed_at")
      .eq("status", "done")
      .not("completed_at", "is", null)
      .gte("completed_at", windowStartIso),
    supabase
      .from("srs_reviews")
      .select("reviewed_at")
      .gte("reviewed_at", windowStartIso),
  ]);

  const firstError = focusRes.error ?? tasksRes.error ?? reviewsRes.error;
  if (firstError) return json({ data: null, error: firstError.message }, 500);

  const sessions = focusRes.data ?? [];
  const completedSessions = sessions.filter((s) => s.completed);
  const doneTasks = tasksRes.data ?? [];
  const reviews = reviewsRes.data ?? [];

  // --- Daily buckets (IST day index) -------------------------------------
  const focusByDay = new Map<number, number>();
  for (const s of completedSessions) {
    const idx = istDayNumber(Date.parse(s.started_at));
    focusByDay.set(idx, (focusByDay.get(idx) ?? 0) + s.duration_minutes);
  }
  const tasksByDay = new Map<number, number>();
  for (const t of doneTasks) {
    if (!t.completed_at) continue;
    const idx = istDayNumber(Date.parse(t.completed_at));
    tasksByDay.set(idx, (tasksByDay.get(idx) ?? 0) + 1);
  }
  const reviewsByDay = new Map<number, number>();
  for (const r of reviews) {
    const idx = istDayNumber(Date.parse(r.reviewed_at));
    reviewsByDay.set(idx, (reviewsByDay.get(idx) ?? 0) + 1);
  }

  // 30-day series with zero-filled gaps. IST has no DST, so stepping the
  // start-of-today instant by whole days lands exactly on IST midnights.
  const dailyFocus: { date: string; minutes: number }[] = [];
  const dailyTasks: { date: string; count: number }[] = [];
  for (let idx = windowStartIdx; idx <= todayIdx; idx++) {
    const date = istDateString(startOfTodayMs - (todayIdx - idx) * DAY_MS);
    dailyFocus.push({ date, minutes: focusByDay.get(idx) ?? 0 });
    dailyTasks.push({ date, count: tasksByDay.get(idx) ?? 0 });
  }

  // --- Week-over-week (IST Monday boundaries via istDayContext) ----------
  const thisWeekStartIdx = istDayNumber(Date.parse(startOfWeek));

  function weekStats(fromIdx: number, toIdx: number): WeekStats {
    let focusMinutes = 0;
    let tasksCompleted = 0;
    let reviewsDone = 0;
    const activeDays = new Set<number>();
    for (let idx = fromIdx; idx <= toIdx; idx++) {
      const f = focusByDay.get(idx) ?? 0;
      const t = tasksByDay.get(idx) ?? 0;
      const r = reviewsByDay.get(idx) ?? 0;
      focusMinutes += f;
      tasksCompleted += t;
      reviewsDone += r;
      if (f > 0 || t > 0 || r > 0) activeDays.add(idx);
    }
    return {
      focusMinutes,
      tasksCompleted,
      reviewsDone,
      activeDays: activeDays.size,
    };
  }

  const thisWeek = weekStats(thisWeekStartIdx, todayIdx);
  const lastWeek = weekStats(thisWeekStartIdx - 7, thisWeekStartIdx - 1);

  // --- Focus by category (completed sessions, 30-day window) -------------
  const byCategory = new Map<string, { totalMinutes: number; sessions: number }>();
  let totalFocusMinutes = 0;
  for (const s of completedSessions) {
    const agg = byCategory.get(s.category) ?? { totalMinutes: 0, sessions: 0 };
    agg.totalMinutes += s.duration_minutes;
    agg.sessions += 1;
    byCategory.set(s.category, agg);
    totalFocusMinutes += s.duration_minutes;
  }
  const categoryBreakdown: CategorySlice[] = Array.from(byCategory.entries())
    .map(([category, agg]) => ({
      category,
      totalMinutes: agg.totalMinutes,
      sessions: agg.sessions,
      percentage:
        totalFocusMinutes > 0
          ? Math.round((agg.totalMinutes / totalFocusMinutes) * 100)
          : 0,
    }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes);

  // --- Insights (only when there's enough signal) -------------------------
  let mostProductiveHour: number | null = null;
  let mostProductiveDay: string | null = null;
  if (completedSessions.length >= MIN_SESSIONS_FOR_INSIGHTS) {
    const byHour = new Map<number, number>();
    const byWeekday = new Map<string, number>();
    for (const s of completedSessions) {
      const ms = Date.parse(s.started_at);
      const hour = istHour(ms);
      byHour.set(hour, (byHour.get(hour) ?? 0) + s.duration_minutes);
      const day = weekdayName.format(new Date(ms));
      byWeekday.set(day, (byWeekday.get(day) ?? 0) + s.duration_minutes);
    }
    for (const [hour, minutes] of Array.from(byHour.entries())) {
      if (
        mostProductiveHour === null ||
        minutes > (byHour.get(mostProductiveHour) ?? 0)
      ) {
        mostProductiveHour = hour;
      }
    }
    for (const [day, minutes] of Array.from(byWeekday.entries())) {
      if (
        mostProductiveDay === null ||
        minutes > (byWeekday.get(mostProductiveDay) ?? 0)
      ) {
        mostProductiveDay = day;
      }
    }
  }

  const data: ProductivityData = {
    dailyFocus,
    dailyTasks,
    categoryBreakdown,
    thisWeek,
    lastWeek,
    totalFocusHours: Math.round((totalFocusMinutes / 60) * 10) / 10,
    totalTasksCompleted: doneTasks.length,
    totalSessions: completedSessions.length,
    mostProductiveHour,
    mostProductiveDay,
  };
  return json<ProductivityData>({ data, error: null });
}
