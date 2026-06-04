import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { calculateSM2 } from "@/lib/srs/sm2";
import type { SrsCard } from "@/types/database";

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

const VALID_RATINGS = [0, 2, 4, 5];

// POST /api/srs/review — grade a card, advance SM-2 state, log the review
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

  const cardId = typeof body.card_id === "string" ? body.card_id : "";
  if (!cardId) return json({ data: null, error: "card_id is required" }, 400);

  const rating = typeof body.rating === "number" ? body.rating : NaN;
  if (!VALID_RATINGS.includes(rating)) {
    return json({ data: null, error: "rating must be 0, 2, 4, or 5" }, 400);
  }

  // Fetch the current card (RLS ensures the user owns it).
  const { data: card, error: fetchError } = await supabase
    .from("srs_cards")
    .select("*")
    .eq("id", cardId)
    .single();

  if (fetchError) return json({ data: null, error: fetchError.message }, 500);
  if (!card) return json({ data: null, error: "Card not found" }, 404);

  // Advance the SM-2 schedule. rating doubles as the SM-2 quality (0|2|4|5).
  const result = calculateSM2(
    rating,
    card.repetitions,
    card.ease_factor,
    card.interval_days
  );

  const nowIso = new Date().toISOString();

  const { data: updatedCard, error: updateError } = await supabase
    .from("srs_cards")
    .update({
      interval_days: result.interval,
      ease_factor: result.easeFactor,
      repetitions: result.repetitions,
      next_review: result.nextReview.toISOString(),
      last_reviewed: nowIso,
      updated_at: nowIso,
    })
    .eq("id", cardId)
    .select()
    .single();

  if (updateError) return json({ data: null, error: updateError.message }, 500);

  // Log the review. A failure here shouldn't lose the schedule update, so we
  // surface it but still return the updated card.
  const { error: reviewError } = await supabase.from("srs_reviews").insert({
    card_id: cardId,
    user_id: user.id,
    rating,
    reviewed_at: nowIso,
  });

  if (reviewError) return json({ data: null, error: reviewError.message }, 500);

  return json<SrsCard>({ data: updatedCard, error: null });
}
