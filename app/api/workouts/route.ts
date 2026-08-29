import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { istDayContext } from "@/lib/date";
import { MAX_RAW_INPUT_LENGTH, parseWorkoutInput } from "@/lib/ai/workout";
import {
  formatStructuredRawInput,
  type StructuredSetInput,
} from "@/lib/workouts";
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
 * How far back GET reaches. THREE things derive from this one window via
 * `select` off the single ["workouts"] cache — today's sets, the session
 * count, and the picker's "Recent" list — so widening it is not a local
 * change. Read the next paragraph before touching it.
 *
 * 60, not 21. The picker's Recent list is sourced from this window, and at 21
 * days it was EVICTING the user's own exercises: the real table's 2026-08-04
 * Back session (Lat Pulldown, Close Grip Row, Pull Up, Chin Up) aged out on
 * 2026-08-25, so four exercises actually trained became reachable only by
 * scrolling the full 66-name library — measured at 1267px and 1391px of scroll
 * against 0px for a library name the user has never done. Recency that makes
 * your own history harder to reach than a stranger's is backwards.
 *
 * THE SESSION COUNT DID NOT MOVE WITH IT. "N sessions in the last 21 days" is
 * a different claim with its own window, and it is now enforced explicitly in
 * countSessionDays(sets, SESSION_COUNT_WINDOW_DAYS) rather than falling out of
 * whatever this constant happens to be. That coupling was silent before: this
 * number was the only thing making that label true.
 *
 * The Today panel is unaffected either way — useTodaysSets filters to the
 * current IST day, so a wider window changes nothing it renders.
 */
const WINDOW_DAYS = 60;
const DAY_MS = 86_400_000;
/** Backstop only. 60 days of heavy lifting is a few hundred rows. */
const MAX_ROWS = 1000;

/**
 * Ceiling on ONE structured submission.
 *
 * The picker submits one exercise's sets per capture, so realistic values are
 * 1-6. 50 is a backstop against a malformed or hostile body, sized off the
 * largest session this codebase documents anywhere (the 12-exercise / 44-set
 * session measured for MAX_TOKENS in lib/ai/workout.ts) — a single capture
 * bigger than an entire session is not a capture.
 */
const MAX_STRUCTURED_SETS = 50;

type StructuredSetsResult =
  | { ok: true; sets: StructuredSetInput[] | null }
  | { ok: false; error: string };

/**
 * Validate the optional `sets` field.
 *
 * ABSENT is the discriminator: no `sets` key means this is a free-text capture
 * and the Groq path below runs exactly as it always has. A present `sets` is
 * validated strictly and 400s on anything malformed — unlike raw text, there
 * is nothing to salvage from a bad number, and silently coercing one would
 * write a wrong weight that looks authoritative.
 *
 * The per-set shape is deliberately as general as the table (an exercise name
 * per set, not one for the whole capture) so a capture can hold more than one
 * exercise, which is what the free-text path already produces — "assisted
 * pullup and chinups" is one capture_id spanning two exercises. Phase 1's UI
 * submits a single exercise; the endpoint does not need to care.
 */
function parseStructuredSets(value: unknown): StructuredSetsResult {
  if (value === undefined || value === null) return { ok: true, sets: null };

  if (!Array.isArray(value)) {
    return { ok: false, error: "Invalid sets" };
  }
  if (value.length === 0) {
    return { ok: false, error: "Nothing to log" };
  }
  if (value.length > MAX_STRUCTURED_SETS) {
    return {
      ok: false,
      error: `Too many sets at once (max ${MAX_STRUCTURED_SETS}).`,
    };
  }

  const sets: StructuredSetInput[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: "Invalid set" };
    }
    const item = raw as Record<string, unknown>;

    const exercise =
      typeof item.exercise === "string" ? item.exercise.trim() : "";
    // An exercise name is the minimum for a row to mean anything — the same
    // bar parseWorkoutInput holds AI output to.
    if (!exercise) {
      return { ok: false, error: "Every set needs an exercise" };
    }

    let weightKg: number | null = null;
    if (item.weight_kg !== undefined && item.weight_kg !== null) {
      if (
        typeof item.weight_kg !== "number" ||
        !Number.isFinite(item.weight_kg) ||
        item.weight_kg < 0
      ) {
        return { ok: false, error: "Invalid weight" };
      }
      // 0 kg is bodyweight, not a zero load — same rule the AI path applies.
      weightKg =
        item.weight_kg === 0 ? null : Math.round(item.weight_kg * 100) / 100;
    }

    let reps: number | null = null;
    if (item.reps !== undefined && item.reps !== null) {
      if (
        typeof item.reps !== "number" ||
        !Number.isInteger(item.reps) ||
        item.reps < 0
      ) {
        return { ok: false, error: "Invalid reps" };
      }
      reps = item.reps === 0 ? null : item.reps;
    }

    sets.push({ exercise: exercise.slice(0, 120), weight_kg: weightKg, reps });
  }

  return { ok: true, sets };
}

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
 * POST /api/workouts — log one capture, structured or free-text.
 *
 * TWO INPUT SHAPES, ONE ROUTE. They differ only in where the numbers come
 * from; everything downstream (capture_id, set_index, the insert, the offline
 * queue entry) is identical.
 *
 *   { sets: [{exercise, weight_kg, reps}, …], performed_at? }
 *       The structured picker. Values are already structured, so there is
 *       nothing to parse and Groq is NOT called — raw_input is synthesized
 *       from the sets instead.
 *
 *   { raw_input, performed_at? }
 *       Gym shorthand, unchanged. Parsing happens HERE, not in the browser, so
 *       the whole operation is a single offline-queueable mutation: a set
 *       logged with no signal replays as one request and parses when
 *       connectivity returns. If the parse throws or yields nothing usable, a
 *       SINGLE row is still inserted with raw_input and null parsed fields —
 *       losing what the user typed is never an acceptable outcome.
 *
 * Both insert one row per set, sharing a generated capture_id and one
 * raw_input, with a 1-based set_index in performed order.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  // This route's OWN per-user cap (100/60s), fully decoupled from the 20/60s
  // budget the five content-generation routes share. POST is the only method
  // here that can reach Groq, so GET/PATCH/DELETE are deliberately exempt.
  //
  // Checked BEFORE the body is read, so it applies to structured captures too
  // even though those never call Groq. That is intentional and the tier is
  // untouched: 100/60s was sized so a whole queued session replaying at once
  // clears it with 2x headroom, and structured captures are the same shape of
  // burst. Making them exempt would mean two ceilings to reason about for one
  // insert path, for no gain — see MAX_WORKOUT_REQUESTS_PER_WINDOW.
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

  const structured = parseStructuredSets(body.sets);
  if (!structured.ok) {
    return json({ data: null, error: structured.error }, 400);
  }

  // A structured capture owns its own raw_input — the server synthesizes it so
  // one place decides the format and an offline replay produces the same
  // string. Any raw_input a structured client sent is ignored rather than
  // trusted. The slice can only bite at ~50 sets with 120-char names; the
  // parsed columns are the real record for these rows, so capping the echo is
  // preferable to rejecting the capture.
  const rawInput = structured.sets
    ? formatStructuredRawInput(structured.sets).slice(0, MAX_RAW_INPUT_LENGTH)
    : typeof body.raw_input === "string"
      ? body.raw_input.trim()
      : "";

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

  /** 1-based position within THIS capture, in performed order. */
  const toRow = (
    s: { exercise: string; weight_kg: number | null; reps: number | null },
    i: number
  ): WorkoutSetInsert => ({
    user_id: user.id,
    capture_id: captureId,
    raw_input: rawInput,
    performed_at: performedAt,
    exercise: s.exercise,
    weight_kg: s.weight_kg,
    reps: s.reps,
    set_index: i + 1,
  });

  let rows: WorkoutSetInsert[];

  if (structured.sets) {
    // Nothing to parse. This is the whole cost saving of the structured path:
    // no Groq call, no failure mode where a set is stored unreadable, and the
    // numbers are exactly what the user tapped.
    rows = structured.sets.map(toRow);
  } else {
    let parsed: Awaited<ReturnType<typeof parseWorkoutInput>> = [];
    try {
      parsed = await parseWorkoutInput(rawInput);
    } catch (err) {
      // Groq down, rate-limited, or unusable output. Fall through to the
      // unparsed row below; the user still has their log and can correct it.
      console.error("Workout parse failed, storing raw row:", err);
    }

    rows =
      parsed.length > 0
        ? parsed.map(toRow)
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
  }

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
