import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { Database, Reminder } from "@/types/database";

type ReminderUpdate = Database["public"]["Tables"]["reminders"]["Update"];

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

/** Validate an ISO timestamp string; returns the ISO if valid, else null. */
function parseIsoTimestamp(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

// GET /api/reminders — all reminders for the authed user, soonest first
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  // Hide reminders that have already passed AND never fired (the clog), but
  // keep upcoming ones and any already-sent ones (the page's "Sent" tab +
  // history). Past-but-not-sent reminders simply drop off once their time passes.
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("reminders")
    .select("*")
    .or(`remind_at.gte.${now},is_sent.eq.true`)
    .order("remind_at", { ascending: true });

  if (error) return json({ data: null, error: error.message }, 500);
  return json<Reminder[]>({ data: data ?? [], error: null });
}

// POST /api/reminders — create
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

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return json({ data: null, error: "Title is required" }, 400);

  const remindAt = parseIsoTimestamp(body.remind_at);
  if (!remindAt) {
    return json({ data: null, error: "A valid remind time is required" }, 400);
  }
  if (Date.parse(remindAt) <= Date.now()) {
    return json({ data: null, error: "Remind time must be in the future" }, 400);
  }

  const { data, error } = await supabase
    .from("reminders")
    .insert({
      user_id: user.id,
      title,
      body:
        typeof body.body === "string" && body.body.trim()
          ? body.body.trim()
          : null,
      remind_at: remindAt,
      task_id: typeof body.task_id === "string" ? body.task_id : null,
      note_id: typeof body.note_id === "string" ? body.note_id : null,
    })
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  return json<Reminder>({ data, error: null }, 201);
}

// PATCH /api/reminders — update (mark is_sent, edit fields). RLS guards ownership.
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
  if (!id) return json({ data: null, error: "Reminder id is required" }, 400);

  const updates: ReminderUpdate = {};
  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return json({ data: null, error: "Title is required" }, 400);
    updates.title = title;
  }
  if (body.body !== undefined) {
    updates.body =
      typeof body.body === "string" && body.body.trim()
        ? body.body.trim()
        : null;
  }
  if (body.remind_at !== undefined) {
    const remindAt = parseIsoTimestamp(body.remind_at);
    if (!remindAt) {
      return json({ data: null, error: "A valid remind time is required" }, 400);
    }
    updates.remind_at = remindAt;
  }
  if (body.is_sent !== undefined) {
    if (typeof body.is_sent !== "boolean") {
      return json({ data: null, error: "is_sent must be a boolean" }, 400);
    }
    updates.is_sent = body.is_sent;
  }
  if (body.task_id !== undefined) {
    updates.task_id = typeof body.task_id === "string" ? body.task_id : null;
  }
  if (body.note_id !== undefined) {
    updates.note_id = typeof body.note_id === "string" ? body.note_id : null;
  }

  if (Object.keys(updates).length === 0) {
    return json({ data: null, error: "No fields to update" }, 400);
  }

  const { data, error } = await supabase
    .from("reminders")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  if (!data) return json({ data: null, error: "Reminder not found" }, 404);
  return json<Reminder>({ data, error: null });
}

// DELETE /api/reminders — delete by id (RLS guarantees ownership)
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

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return json({ data: null, error: "Reminder id is required" }, 400);

  const { error } = await supabase.from("reminders").delete().eq("id", id);
  if (error) return json({ data: null, error: error.message }, 500);
  return json<{ id: string }>({ data: { id }, error: null });
}
