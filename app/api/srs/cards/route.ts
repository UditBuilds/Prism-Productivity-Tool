import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { Database, SrsCard } from "@/types/database";

type SrsCardUpdate = Database["public"]["Tables"]["srs_cards"]["Update"];

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

// GET /api/srs/cards — all cards; ?deck=name filters, ?due=true → due now only
export async function GET(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  const { searchParams } = new URL(request.url);
  const deck = searchParams.get("deck");
  const dueOnly = searchParams.get("due") === "true";

  let query = supabase
    .from("srs_cards")
    .select("*")
    .order("next_review", { ascending: true });

  if (deck) query = query.eq("deck_name", deck);
  if (dueOnly) query = query.lte("next_review", new Date().toISOString());

  const { data, error } = await query;
  if (error) return json({ data: null, error: error.message }, 500);
  return json<SrsCard[]>({ data: data ?? [], error: null });
}

// POST /api/srs/cards — create card manually
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

  const front = typeof body.front === "string" ? body.front.trim() : "";
  const back = typeof body.back === "string" ? body.back.trim() : "";
  if (!front) return json({ data: null, error: "Front is required" }, 400);
  if (!back) return json({ data: null, error: "Back is required" }, 400);

  const deckName =
    typeof body.deck_name === "string" && body.deck_name.trim()
      ? body.deck_name.trim()
      : "Default";

  const { data, error } = await supabase
    .from("srs_cards")
    .insert({
      user_id: user.id,
      front,
      back,
      deck_name: deckName,
      note_id: typeof body.note_id === "string" ? body.note_id : null,
    })
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  return json<SrsCard>({ data, error: null }, 201);
}

// PATCH /api/srs/cards — edit front/back/deck_name (RLS guards ownership)
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
  if (!id) return json({ data: null, error: "Card id is required" }, 400);

  const updates: SrsCardUpdate = {};
  if (body.front !== undefined) {
    const front = typeof body.front === "string" ? body.front.trim() : "";
    if (!front) return json({ data: null, error: "Front is required" }, 400);
    updates.front = front;
  }
  if (body.back !== undefined) {
    const back = typeof body.back === "string" ? body.back.trim() : "";
    if (!back) return json({ data: null, error: "Back is required" }, 400);
    updates.back = back;
  }
  if (body.deck_name !== undefined) {
    updates.deck_name =
      typeof body.deck_name === "string" && body.deck_name.trim()
        ? body.deck_name.trim()
        : "Default";
  }

  if (Object.keys(updates).length === 0) {
    return json({ data: null, error: "No fields to update" }, 400);
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("srs_cards")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  if (!data) return json({ data: null, error: "Card not found" }, 404);
  return json<SrsCard>({ data, error: null });
}

// DELETE /api/srs/cards — delete by id (RLS guarantees ownership)
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
  if (!id) return json({ data: null, error: "Card id is required" }, 400);

  const { error } = await supabase.from("srs_cards").delete().eq("id", id);
  if (error) return json({ data: null, error: error.message }, 500);
  return json<{ id: string }>({ data: { id }, error: null });
}
