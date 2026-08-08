import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { istDayContext } from "@/lib/date";
import { MAX_RAW_INPUT_LENGTH, parseWorkoutInput } from "@/lib/ai/workout";
import {
  aiRateLimitHeaders,
  aiRateLimitMessage,
  checkWorkoutRateLimit,
} from "@/lib/ai/rateLimit";
import type { Database, WorkoutSet } from "@/types/database";

type WorkoutSetInsert =
  Database["public"]["Tables"]["workout_sets"]["Insert"];
type WorkoutSetUpdate =
  Database["public"]["Tables"]["workout_sets"]["Update"];

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(
  body: ApiResponse<T>,
  status = 200,
  headers?: Record<string, string>
) {
  return NextResponse.json(body, { status, headers });
}

/**
 * The Groq round-trip runs inside POST, so give it room. Measured parses are
 * well under 2s, but a cold Groq call on a long session should not 504.
 */
export const maxDuration = 30;

/**
 * How far back GET reaches. The card needs today's sets AND a 21-day session
 * count, so one window feeds both and the client derives each with `select`
 * off the single ["workouts"] cache — the same trick useTodaysMood uses.
 */
const WINDOW_DAYS = 21;
const DAY_MS = 86_400_000;
/** Backstop only. 21 days of heavy lifting is a few hundred rows. */
const MAX_ROWS = 1000;

// GET /api/workouts — every set in the last 21 IST days, oldest first.
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  // Instant arithmetic off 00:00 IST today (IST is a fixed +05:30, no DST) —
  // never civil Date field math, which shifts a day when the server is UTC.
  const { startOfToday } = istDayContext();
  const windowStart = new Date(
    Date.parse(startOfToday) - (WINDOW_DAYS - 1) * DAY_MS
  ).toISOString();

  const { data, error } = await supabase
    .from("workout_sets")
    .select("*")
    .gte("performed_at", windowStart)
    .order("performed_at", { ascending: true })
    .order("set_index", { ascending: true, nullsFirst: false })
    .limit(MAX_ROWS);

  if (error) return json({ data: null, error: error.message }, 500);
  return json<WorkoutSet[]>({ data: data ?? [], error: null });
}

/**
 * POST /api/workouts — log one capture of gym shorthand.
 *
 * Parsing happens HERE, not in the browser, so the whole operation is a single
 * offline-queueable mutation: a set logged with no signal replays as one
 * request and parses when connectivity returns.
 *
 * Body: { raw_input, performed_at? }
 * Inserts one row per parsed set, all sharing a generated capture_id and the
 * verbatim raw_input. If the parse throws or yields nothing usable, a SINGLE
 * row is still inserted with raw_input and null parsed fields — losing what
 * the user typed is never an acceptable outcome.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  // This route's OWN per-user cap (100/60s), fully decoupled from the 20/60s
  // budget the five content-generation routes share. POST is the only method
  // here that reaches Groq, so GET/PATCH/DELETE are deliberately exempt.
  //
  // The separate, much higher ceiling exists because a rejection here means NO
  // row is inserted — the capture is lost rather than stored unparsed, and the
  // retryer can't save it (a 429 is indistinguishable from a network failure to
  // it, and all 3 retries land inside the same window). Sharing the low ceiling
  // would let a PDF analysis burn the budget a gym session then needs. See
  // MAX_WORKOUT_REQUESTS_PER_WINDOW in lib/ai/rateLimit.ts.
  const rateLimit = checkWorkoutRateLimit(user.id);
  if (!rateLimit.allowed) {
    return json(
      { data: null, error: aiRateLimitMessage(rateLimit.retryAfterSeconds) },
      429,
      aiRateLimitHeaders(rateLimit.retryAfterSeconds)
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ data: null, error: "Invalid JSON body" }, 400);
  }

  const rawInput =
    typeof body.raw_input === "string" ? body.raw_input.trim() : "";
  if (!rawInput) {
    return json({ data: null, error: "Nothing to log" }, 400);
  }
  if (rawInput.length > MAX_RAW_INPUT_LENGTH) {
    return json(
      {
        data: null,
        error: `That's too long to log at once (max ${MAX_RAW_INPUT_LENGTH} characters).`,
      },
      400
    );
  }

  // performed_at lets an offline replay keep the time the set was actually
  // logged rather than the time it happened to sync. Invalid input falls back
  // to now rather than 400-ing — the set matters more than its timestamp.
  const performedAt =
    typeof body.performed_at === "string" &&
    !Number.isNaN(Date.parse(body.performed_at))
      ? new Date(body.performed_at).toISOString()
      : new Date().toISOString();

  const captureId = crypto.randomUUID();

  let parsed: Awaited<ReturnType<typeof parseWorkoutInput>> = [];
  try {
    parsed = await parseWorkoutInput(rawInput);
  } catch (err) {
    // Groq down, rate-limited, or unusable output. Fall through to the
    // unparsed row below; the user still has their log and can correct it.
    console.error("Workout parse failed, storing raw row:", err);
  }

  const rows: WorkoutSetInsert[] =
    parsed.length > 0
      ? parsed.map((s, i) => ({
          user_id: user.id,
          capture_id: captureId,
          raw_input: rawInput,
          performed_at: performedAt,
          exercise: s.exercise,
          weight_kg: s.weight_kg,
          reps: s.reps,
          // 1-based position within THIS capture, in performed order.
          set_index: i + 1,
        }))
      : [
          {
            user_id: user.id,
            capture_id: captureId,
            raw_input: rawInput,
            performed_at: performedAt,
            exercise: null,
            weight_kg: null,
            reps: null,
            set_index: null,
          },
        ];

  const { data, error } = await supabase
    .from("workout_sets")
    .insert(rows)
    .select()
    .order("set_index", { ascending: true, nullsFirst: false });

  if (error) return json({ data: null, error: error.message }, 500);
  return json<WorkoutSet[]>({ data: data ?? [], error: null }, 201);
}

/**
 * PATCH /api/workouts — correct ONE row.
 * Body: { id, exercise?, weight_kg?, reps? }
 * Only the keys present are written, so a weight-only fix can't blank the
 * reps. raw_input, capture_id and performed_at are immutable here: the
 * capture is the record of what was typed, corrections only touch the parse.
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
  if (!id) return json({ data: null, error: "Missing set id" }, 400);

  const updates: WorkoutSetUpdate = {};

  if ("exercise" in body) {
    if (body.exercise === null) {
      updates.exercise = null;
    } else if (typeof body.exercise === "string") {
      const name = body.exercise.trim();
      updates.exercise = name ? name.slice(0, 120) : null;
    } else {
      return json({ data: null, error: "Invalid exercise" }, 400);
    }
  }

  if ("weight_kg" in body) {
    if (body.weight_kg === null) {
      updates.weight_kg = null;
    } else if (
      typeof body.weight_kg === "number" &&
      Number.isFinite(body.weight_kg) &&
      body.weight_kg >= 0
    ) {
      updates.weight_kg = Math.round(body.weight_kg * 100) / 100;
    } else {
      return json({ data: null, error: "Invalid weight" }, 400);
    }
  }

  if ("reps" in body) {
    if (body.reps === null) {
      updates.reps = null;
    } else if (
      typeof body.reps === "number" &&
      Number.isInteger(body.reps) &&
      body.reps >= 0
    ) {
      updates.reps = body.reps;
    } else {
      return json({ data: null, error: "Invalid reps" }, 400);
    }
  }

  if (Object.keys(updates).length === 0) {
    return json({ data: null, error: "No fields to update" }, 400);
  }

  // RLS already scopes this to the caller; the explicit user_id filter is
  // defence in depth on a table whose rows are otherwise addressable by id.
  const { data, error } = await supabase
    .from("workout_sets")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  return json<WorkoutSet>({ data, error: null });
}

// DELETE /api/workouts — remove ONE set row. Body: { id }
export async function DELETE(request: Request) {
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
  if (!id) return json({ data: null, error: "Missing set id" }, 400);

  const { error } = await supabase
    .from("workout_sets")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return json({ data: null, error: error.message }, 500);
  return json<{ id: string }>({ data: { id }, error: null });
}
