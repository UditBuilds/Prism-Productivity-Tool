import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { istDayContext, istDateString } from "@/lib/date";
import { analyseWorkoutSets, type WorkoutAnalysis } from "@/lib/workout-analysis";
import type { WorkoutSet } from "@/types/database";

type ApiResponse<T> = { data: T | null; error: string | null };

const DAY_MS = 86_400_000;

/**
 * Analysis reads far further back than logging does.
 *
 * GET /api/workouts is capped at 21 days because it feeds the logging screen —
 * today's sets and a 21-day session count. Reusing it here would have been a
 * silent time bomb: the real table's two sessions are 2026-08-04 and
 * 2026-08-11, so on 2026-08-26 the older one falls out of a 21-day window and
 * four of the five exercises lose the only session they have. A progression
 * view whose history quietly evaporates is worse than no progression view.
 *
 * 180 days rather than unbounded: a top-set comparison against work from more
 * than half a year ago is not progressive overload, it is archaeology, and the
 * window doubles as the row bound.
 */
const WINDOW_DAYS = 180;
/** Backstop only. 180 days of heavy lifting is a few thousand rows. */
const MAX_ROWS = 5000;

export type { WorkoutAnalysis };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

/**
 * Progressive overload + body-part balance over the last 180 IST days.
 *
 * Its own route rather than a widened /api/workouts: the logging screen would
 * otherwise download six months of history on every visit to show today's
 * sets, and Phase 1's cache shape stays untouched.
 */
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json<WorkoutAnalysis>({ data: null, error: "Unauthorized" }, 401);

  const { startOfToday } = istDayContext();
  const windowStart = new Date(
    Date.parse(startOfToday) - (WINDOW_DAYS - 1) * DAY_MS
  ).toISOString();

  const { data, error } = await supabase
    .from("workout_sets")
    .select("*")
    .eq("user_id", user.id)
    .gte("performed_at", windowStart)
    .order("performed_at", { ascending: true })
    .order("set_index", { ascending: true, nullsFirst: false })
    .limit(MAX_ROWS);

  if (error) {
    return json<WorkoutAnalysis>({ data: null, error: error.message }, 500);
  }

  // The server's IST day, not the browser's — "3 days ago" must not change
  // because a device clock is off or a tab is open across IST midnight.
  const analysis = analyseWorkoutSets(
    (data ?? []) as WorkoutSet[],
    WINDOW_DAYS,
    istDateString()
  );

  return json<WorkoutAnalysis>({ data: analysis, error: null });
}
