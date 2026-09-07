import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { istDateString, istDayContext } from "@/lib/date";
import type { WorkoutSessionStatus } from "@/types/database";

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

const DAY_MS = 86_400_000;

/**
 * 180 days, matching /api/workouts/analysis rather than /api/workouts' 60.
 *
 * History is a record, not a logging surface: the reach that makes the
 * progression view honest is the reach that makes "every session I've done"
 * honest. The rows are tiny — one per training DAY, so six months of real
 * training is single digits, against the 60-day set fetch's dozens.
 */
const WINDOW_DAYS = 180;
/** Backstop only. A session per day for 180 days cannot exceed 180. */
const MAX_SESSIONS = 400;
/** Backstop on the set rows read purely to count them. */
const MAX_SETS = 5000;

/** One session as History and the Finish review need it. */
export interface WorkoutSessionSummary {
  id: string;
  /** IST civil day, "YYYY-MM-DD". */
  performed_on: string;
  status: WorkoutSessionStatus;
  started_at: string | null;
  ended_at: string | null;
  notes: string | null;
  template_id: string | null;
  exerciseCount: number;
  setCount: number;
  /** Exercise names in the order they were trained. */
  exercises: string[];
}

/**
 * GET /api/workouts/sessions — every session in the last 180 IST days,
 * newest first, with the counts a list row shows.
 *
 * COUNTED IN JS OVER THREE QUERIES rather than through a nested PostgREST
 * aggregate, matching /api/analytics/productivity. The alternative
 * (`session_exercises(id, workout_sets(count))`) nests two levels deep and
 * makes the row shape depend on PostgREST's embedding rules — for a few dozen
 * rows that is complexity bought with nothing.
 */
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  // A civil DATE column, so the bound is a civil date — derived from the IST
  // day context rather than from a raw Date, which shifts back a day on a UTC
  // box.
  const { startOfToday } = istDayContext();
  const windowStart = istDateString(
    Date.parse(startOfToday) - (WINDOW_DAYS - 1) * DAY_MS
  );

  const { data: sessions, error: sessionsError } = await supabase
    .from("workout_sessions")
    .select("*")
    .eq("user_id", user.id)
    .gte("performed_on", windowStart)
    .order("performed_on", { ascending: false })
    .limit(MAX_SESSIONS);

  if (sessionsError) {
    return json({ data: null, error: sessionsError.message }, 500);
  }

  const sessionIds = (sessions ?? []).map((s) => s.id);
  if (sessionIds.length === 0) {
    return json<WorkoutSessionSummary[]>({ data: [], error: null });
  }

  const { data: exercises, error: exercisesError } = await supabase
    .from("session_exercises")
    .select("id, session_id, display_name, position")
    .eq("user_id", user.id)
    .in("session_id", sessionIds)
    .order("position", { ascending: true });

  if (exercisesError) {
    return json({ data: null, error: exercisesError.message }, 500);
  }

  const exerciseIds = (exercises ?? []).map((e) => e.id);
  // Only the linking column is read — this query exists to be counted.
  const { data: sets, error: setsError } =
    exerciseIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("workout_sets")
          .select("session_exercise_id")
          .eq("user_id", user.id)
          .in("session_exercise_id", exerciseIds)
          .limit(MAX_SETS);

  if (setsError) return json({ data: null, error: setsError.message }, 500);

  const setsByExercise = new Map<string, number>();
  for (const row of sets ?? []) {
    const key = row.session_exercise_id;
    if (!key) continue;
    setsByExercise.set(key, (setsByExercise.get(key) ?? 0) + 1);
  }

  const bySession = new Map<
    string,
    { names: string[]; exerciseCount: number; setCount: number }
  >();
  for (const exercise of exercises ?? []) {
    let entry = bySession.get(exercise.session_id);
    if (!entry) {
      entry = { names: [], exerciseCount: 0, setCount: 0 };
      bySession.set(exercise.session_id, entry);
    }
    entry.names.push(exercise.display_name);
    entry.exerciseCount += 1;
    entry.setCount += setsByExercise.get(exercise.id) ?? 0;
  }

  const summaries: WorkoutSessionSummary[] = (sessions ?? []).map((s) => {
    const counts = bySession.get(s.id);
    return {
      id: s.id,
      performed_on: s.performed_on,
      status: s.status,
      started_at: s.started_at,
      ended_at: s.ended_at,
      notes: s.notes,
      template_id: s.template_id,
      exerciseCount: counts?.exerciseCount ?? 0,
      setCount: counts?.setCount ?? 0,
      exercises: counts?.names ?? [],
    };
  });

  return json<WorkoutSessionSummary[]>({ data: summaries, error: null });
}

/**
 * PATCH /api/workouts/sessions — finish (or reopen) a session, and set notes.
 * Body: { id, status?, notes? }
 *
 * `ended_at` is owned HERE, not by the caller: finishing means "now", and a
 * client-supplied end time is a claim the server has no reason to trust.
 * Reopening clears it, so a session can never read as completed-with-no-end or
 * active-with-an-end.
 *
 * Only the keys present are written, so setting notes cannot silently finish a
 * session — the same rule PATCH /api/workouts follows for a set's columns.
 */
export async function PATCH(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ data: null, error: "Invalid JSON body" }, 400);
  }

  const id = typeof body.id === "string" ? body.id : null;
  if (!id) return json({ data: null, error: "Missing session id" }, 400);

  const updates: {
    status?: WorkoutSessionStatus;
    ended_at?: string | null;
    notes?: string | null;
  } = {};

  if ("status" in body) {
    if (body.status !== "active" && body.status !== "completed") {
      return json({ data: null, error: "Invalid status" }, 400);
    }
    updates.status = body.status;
    updates.ended_at =
      body.status === "completed" ? new Date().toISOString() : null;
  }

  if ("notes" in body) {
    if (body.notes === null) {
      updates.notes = null;
    } else if (typeof body.notes === "string") {
      const text = body.notes.trim();
      updates.notes = text ? text.slice(0, 2000) : null;
    } else {
      return json({ data: null, error: "Invalid notes" }, 400);
    }
  }

  if (Object.keys(updates).length === 0) {
    return json({ data: null, error: "No fields to update" }, 400);
  }

  const { data, error } = await supabase
    .from("workout_sessions")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  return json<{ id: string }>({ data: { id: data.id }, error: null });
}
