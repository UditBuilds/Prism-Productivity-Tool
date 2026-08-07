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

/**
 * Confirm a submitted task_id / note_id names a row this user owns.
 *
 * RLS scopes the REMINDER to the caller but not what it points at — both FKs
 * are plain columns, so any UUID the client sends is stored as-is. Defence in
 * depth on top of RLS, not a replacement for it.
 *
 * A malformed UUID makes Postgres reject the comparison (22P02) rather than
 * return no rows, so an error counts as "not owned" — that turns what is
 * currently a raw 500 from the insert into a clean 404.
 */
async function ownsRow(
  supabase: ReturnType<typeof createClient>,
  table: "tasks" | "notes",
  id: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return !error && !!data;
}

/**
 * Read an optional FK off a request body and check ownership when present.
 *
 * Absent and explicitly-null both mean "no link" and are always allowed — the
 * common case. ReminderForm and the task-form path send `null` outright when
 * nothing is linked, so an ownership check that rejected null would break every
 * ordinary reminder.
 */
async function resolveOptionalFk(
  supabase: ReturnType<typeof createClient>,
  value: unknown,
  table: "tasks" | "notes",
  userId: string,
  label: string
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const id = typeof value === "string" ? value : null;
  if (id === null) return { ok: true, id: null };
  if (!(await ownsRow(supabase, table, id, userId))) {
    return { ok: false, error: `${label} not found` };
  }
  return { ok: true, id };
}

// GET /api/reminders — all reminders for the authed user, soonest first
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  // Return all reminders. Past-due unsent reminders are included so the
  // client-side NotificationChecker can fire them — filtering by remind_at
  // here made due reminders vanish from the cache on refetch before the
  // 60s checker tick could see them.
  const { data, error } = await supabase
    .from("reminders")
    .select("*")
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

  // Both links are optional, but a present one must belong to the caller.
  const taskFk = await resolveOptionalFk(
    supabase,
    body.task_id,
    "tasks",
    user.id,
    "Task"
  );
  if (!taskFk.ok) return json({ data: null, error: taskFk.error }, 404);

  const noteFk = await resolveOptionalFk(
    supabase,
    body.note_id,
    "notes",
    user.id,
    "Note"
  );
  if (!noteFk.ok) return json({ data: null, error: noteFk.error }, 404);

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
      task_id: taskFk.id,
      note_id: noteFk.id,
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
  // Same ownership rule as POST — the Reminders page relinks through here, so
  // fixing only the create path would leave the identical hole one verb away.
  if (body.task_id !== undefined) {
    const fk = await resolveOptionalFk(
      supabase,
      body.task_id,
      "tasks",
      user.id,
      "Task"
    );
    if (!fk.ok) return json({ data: null, error: fk.error }, 404);
    updates.task_id = fk.id;
  }
  if (body.note_id !== undefined) {
    const fk = await resolveOptionalFk(
      supabase,
      body.note_id,
      "notes",
      user.id,
      "Note"
    );
    if (!fk.ok) return json({ data: null, error: fk.error }, 404);
    updates.note_id = fk.id;
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
