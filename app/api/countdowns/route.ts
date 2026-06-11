import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { Countdown } from "@/types/database";

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

// GET /api/countdowns — all countdowns, soonest first
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  const { data, error } = await supabase
    .from("countdowns")
    .select("*")
    .order("target_date", { ascending: true });

  if (error) return json({ data: null, error: error.message }, 500);
  return json<Countdown[]>({ data: data ?? [], error: null });
}

// POST /api/countdowns — create
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

  const targetDate =
    typeof body.target_date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.target_date)
      ? body.target_date
      : "";
  if (!targetDate) {
    return json({ data: null, error: "A valid target date is required" }, 400);
  }

  const { data, error } = await supabase
    .from("countdowns")
    .insert({
      user_id: user.id,
      title,
      target_date: targetDate,
      emoji:
        typeof body.emoji === "string" && body.emoji.trim()
          ? body.emoji.trim()
          : "🎯",
    })
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  return json<Countdown>({ data, error: null }, 201);
}

// DELETE /api/countdowns — delete by id (RLS guards ownership)
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
  if (!id) return json({ data: null, error: "Countdown id is required" }, 400);

  const { error } = await supabase.from("countdowns").delete().eq("id", id);
  if (error) return json({ data: null, error: error.message }, 500);
  return json<{ id: string }>({ data: { id }, error: null });
}
