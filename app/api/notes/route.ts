import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { markdownExcerpt } from "@/lib/markdown";
import type { Database, Note } from "@/types/database";

type NoteUpdate = Database["public"]["Tables"]["notes"]["Update"];

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

/** Normalize an incoming tags value into a clean, de-duped string array. */
function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter(Boolean);
  return Array.from(new Set(cleaned));
}

// GET /api/notes — all notes for the authed user
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) return json({ data: null, error: error.message }, 500);
  return json<Note[]>({ data: data ?? [], error: null });
}

// POST /api/notes — create
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

  let title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content : "";

  // Capture kinds (spark/revisit) don't require a title. Revisit derives one
  // from the text (its dashboard card leads with a title); Spark stays
  // untitled — the body IS the note, and a derived title would just duplicate
  // it on the card. Legacy calls (no kind) keep the original requirement.
  const kind =
    body.kind === "spark" || body.kind === "revisit" ? body.kind : null;
  if (kind) {
    if (!title && kind === "revisit") title = markdownExcerpt(content, 60);
    if (!title && !content.trim()) {
      return json({ data: null, error: "Note is empty" }, 400);
    }
  } else if (!title) {
    return json({ data: null, error: "Title is required" }, 400);
  }

  const { data, error } = await supabase
    .from("notes")
    .insert({
      user_id: user.id,
      title,
      content,
      tags: parseTags(body.tags),
      kind,
    })
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  return json<Note>({ data, error: null }, 201);
}

// PATCH /api/notes — update (RLS guarantees ownership)
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
  if (!id) return json({ data: null, error: "Note id is required" }, 400);

  const updates: NoteUpdate = {};
  if (body.title !== undefined) {
    // Empty is allowed — untitled Sparks round-trip through the edit modal
    // with title "". The modal still requires a title for every other kind.
    updates.title =
      typeof body.title === "string" ? body.title.trim() : "";
  }
  if (body.content !== undefined) {
    updates.content = typeof body.content === "string" ? body.content : "";
  }
  if (body.tags !== undefined) {
    updates.tags = parseTags(body.tags);
  }
  // Kind is switchable between Spark and Revisit only. Anything else (incl.
  // "recall", which is never stored on a note) is ignored — the DB CHECK
  // constraint is the backstop.
  if (body.kind === "spark" || body.kind === "revisit") {
    updates.kind = body.kind;
  }

  if (Object.keys(updates).length === 0) {
    return json({ data: null, error: "No fields to update" }, 400);
  }

  // Touch updated_at so the list re-sorts to the top after an edit.
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("notes")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  if (!data) return json({ data: null, error: "Note not found" }, 404);
  return json<Note>({ data, error: null });
}

// DELETE /api/notes — delete by id (RLS guarantees ownership)
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
  if (!id) return json({ data: null, error: "Note id is required" }, 400);

  const { error } = await supabase.from("notes").delete().eq("id", id);
  if (error) return json({ data: null, error: error.message }, 500);
  return json<{ id: string }>({ data: { id }, error: null });
}
