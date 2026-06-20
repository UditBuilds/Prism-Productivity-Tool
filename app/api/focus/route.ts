import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { Database, FocusSession } from "@/types/database";

type FocusUpdate = Database["public"]["Tables"]["focus_sessions"]["Update"];

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

// GET /api/focus — recent sessions (last 5)
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  const { data, error } = await supabase
    .from("focus_sessions")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(5);

  if (error) return json({ data: null, error: error.message }, 500);
  return json<FocusSession[]>({ data: data ?? [], error: null });
}

// POST /api/focus — start a session
export async function POST(request: Request) {
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

  const durationMinutes =
    typeof body.duration_minutes === "number" ? body.duration_minutes : NaN;
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return json({ data: null, error: "duration_minutes is required" }, 400);
  }

  const { data, error } = await supabase
    .from("focus_sessions")
    .insert({
      user_id: user.id,
      category:
        typeof body.category === "string" && body.category.trim()
          ? body.category.trim()
          : "Study",
      duration_minutes: Math.round(durationMinutes),
    })
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  return json<FocusSession>({ data, error: null }, 201);
}

// PATCH /api/focus — end/complete a session (RLS guards ownership)
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

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return json({ data: null, error: "Session id is required" }, 400);

  const updates: FocusUpdate = {};
  // An end (natural completion or manual stop) sends `completed` → also stamp
  // ended_at at that moment.
  if (typeof body.completed === "boolean") {
    updates.completed = body.completed;
    updates.ended_at = new Date().toISOString();
  }
  // elapsed_seconds can be updated on its own (the per-20s heartbeat) — no
  // completed/ended_at required for an elapsed-only update to succeed.
  if (
    typeof body.elapsed_seconds === "number" &&
    Number.isFinite(body.elapsed_seconds)
  ) {
    updates.elapsed_seconds = Math.max(0, Math.round(body.elapsed_seconds));
  }

  if (Object.keys(updates).length === 0) {
    return json({ data: null, error: "No fields to update" }, 400);
  }

  const { data, error } = await supabase
    .from("focus_sessions")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  if (!data) return json({ data: null, error: "Session not found" }, 404);
  return json<FocusSession>({ data, error: null });
}
