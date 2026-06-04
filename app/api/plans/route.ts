import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { Database, Plan, PlanStatus } from "@/types/database";

type PlanUpdate = Database["public"]["Tables"]["plans"]["Update"];

const STATUSES: PlanStatus[] = ["active", "completed", "archived"];

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

function isStatus(v: unknown): v is PlanStatus {
  return typeof v === "string" && STATUSES.includes(v as PlanStatus);
}

// GET /api/plans — all plans for the authed user
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .order("target_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) return json({ data: null, error: error.message }, 500);
  return json<Plan[]>({ data: data ?? [], error: null });
}

// POST /api/plans — create
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

  if (body.status !== undefined && !isStatus(body.status)) {
    return json({ data: null, error: "Invalid status" }, 400);
  }

  const { data, error } = await supabase
    .from("plans")
    .insert({
      user_id: user.id,
      title,
      description:
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim()
          : null,
      status: isStatus(body.status) ? body.status : "active",
      target_date:
        typeof body.target_date === "string" ? body.target_date : null,
    })
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  return json<Plan>({ data, error: null }, 201);
}

// PATCH /api/plans — update (RLS guarantees ownership)
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
  if (!id) return json({ data: null, error: "Plan id is required" }, 400);

  const updates: PlanUpdate = {};
  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return json({ data: null, error: "Title is required" }, 400);
    updates.title = title;
  }
  if (body.description !== undefined) {
    updates.description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
  }
  if (body.status !== undefined) {
    if (!isStatus(body.status))
      return json({ data: null, error: "Invalid status" }, 400);
    updates.status = body.status;
  }
  if (body.target_date !== undefined) {
    updates.target_date =
      typeof body.target_date === "string" ? body.target_date : null;
  }

  if (Object.keys(updates).length === 0) {
    return json({ data: null, error: "No fields to update" }, 400);
  }

  const { data, error } = await supabase
    .from("plans")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  if (!data) return json({ data: null, error: "Plan not found" }, 404);
  return json<Plan>({ data, error: null });
}

// DELETE /api/plans — delete by id (RLS guarantees ownership).
// Tasks reference plans via ON DELETE SET NULL, so they are simply unlinked.
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
  if (!id) return json({ data: null, error: "Plan id is required" }, 400);

  const { error } = await supabase.from("plans").delete().eq("id", id);
  if (error) return json({ data: null, error: error.message }, 500);
  return json<{ id: string }>({ data: { id }, error: null });
}
