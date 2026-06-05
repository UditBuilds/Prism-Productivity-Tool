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

type CardInsert = Database["public"]["Tables"]["srs_cards"]["Insert"];

/** Coerce one raw card into a clean insert row, or null if invalid. */
function toCardRow(raw: unknown, userId: string): CardInsert | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  const front = typeof c.front === "string" ? c.front.trim() : "";
  const back = typeof c.back === "string" ? c.back.trim() : "";
  if (!front || !back) return null;
  return {
    user_id: userId,
    front,
    back,
    deck_name:
      typeof c.deck_name === "string" && c.deck_name.trim()
        ? c.deck_name.trim()
        : "Default",
    note_id: typeof c.note_id === "string" ? c.note_id : null,
  };
}

// POST /api/srs/cards — create one card (object body) or many (array body)
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ data: null, error: "Invalid JSON body" }, 400);
  }

  // Bulk path: an array of cards → single insert (used by AI generation).
  if (Array.isArray(body)) {
    const rows = body
      .map((card) => toCardRow(card, user.id))
      .filter((row): row is CardInsert => row !== null);

    if (rows.length === 0) {
      return json({ data: null, error: "No valid cards to save" }, 400);
    }

    const { data, error } = await supabase
      .from("srs_cards")
      .insert(rows)
      .select();

    if (error) return json({ data: null, error: error.message }, 500);
    return json<SrsCard[]>({ data: data ?? [], error: null }, 201);
  }

  const single = (typeof body === "object" && body !== null
    ? body
    : {}) as Record<string, unknown>;

  const front = typeof single.front === "string" ? single.front.trim() : "";
  const back = typeof single.back === "string" ? single.back.trim() : "";
  if (!front) return json({ data: null, error: "Front is required" }, 400);
  if (!back) return json({ data: null, error: "Back is required" }, 400);

  const deckName =
    typeof single.deck_name === "string" && single.deck_name.trim()
      ? single.deck_name.trim()
      : "Default";

  const { data, error } = await supabase
    .from("srs_cards")
    .insert({
      user_id: user.id,
      front,
      back,
      deck_name: deckName,
      note_id: typeof single.note_id === "string" ? single.note_id : null,
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
