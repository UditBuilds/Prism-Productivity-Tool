import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

// DELETE /api/srs/decks?deckName=Name — remove every card in one deck.
// (RLS guarantees ownership; the explicit user_id filter is belt-and-braces.)
export async function DELETE(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  const { searchParams } = new URL(request.url);
  const deckName = (searchParams.get("deckName") ?? "").trim();
  if (!deckName) {
    return json({ data: null, error: "deckName is required" }, 400);
  }

  const { data, error } = await supabase
    .from("srs_cards")
    .delete()
    .eq("user_id", user.id)
    .eq("deck_name", deckName)
    .select("id");

  if (error) return json({ data: null, error: error.message }, 500);
  return json<{ deleted: number }>({
    data: { deleted: (data ?? []).length },
    error: null,
  });
}

// PATCH /api/srs/decks — rename a deck (bulk deck_name update across cards).
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

  const oldName = typeof body.oldName === "string" ? body.oldName : "";
  const newName = typeof body.newName === "string" ? body.newName.trim() : "";
  if (!oldName) return json({ data: null, error: "oldName is required" }, 400);
  if (!newName) return json({ data: null, error: "newName is required" }, 400);
  if (newName === oldName) {
    return json({ data: null, error: "New name must be different" }, 400);
  }

  const { data, error } = await supabase
    .from("srs_cards")
    .update({ deck_name: newName })
    .eq("user_id", user.id)
    .eq("deck_name", oldName)
    .select("id");

  if (error) return json({ data: null, error: error.message }, 500);
  return json<{ updated: number }>({
    data: { updated: (data ?? []).length },
    error: null,
  });
}
