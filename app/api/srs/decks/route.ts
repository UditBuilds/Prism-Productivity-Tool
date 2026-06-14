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
