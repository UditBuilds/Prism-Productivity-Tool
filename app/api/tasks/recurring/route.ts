import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { RecurringTask } from "@/types/database";

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

// GET /api/tasks/recurring — the authed user's ACTIVE recurring templates.
// This is the persistent "your task repeats, even if nothing spawned today"
// surface: on a non-scheduled day the tasks list alone looks like the create
// silently did nothing.
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  const { data, error } = await supabase
    .from("recurring_tasks")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) return json({ data: null, error: error.message }, 500);
  return json<RecurringTask[]>({ data: data ?? [], error: null });
}

// PATCH /api/tasks/recurring — { id } deactivates a template directly (no
// task instance needed — on a non-scheduled day there is none to go through).
// Same semantics as the TaskCard "Stop repeating" action: instances are kept.
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
  if (!id) return json({ data: null, error: "Template id is required" }, 400);

  const { data, error } = await supabase
    .from("recurring_tasks")
    .update({ is_active: false })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) return json({ data: null, error: error.message }, 500);
  if (!data) return json({ data: null, error: "Template not found" }, 404);
  return json<{ id: string }>({ data: { id }, error: null });
}
