import { json } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { generateFlashcardsFromNote, MAX_SOURCE_CHARS } from "@/lib/ai/client";
import {
  aiRateLimitHeaders,
  aiRateLimitMessage,
  checkAiRateLimit,
} from "@/lib/ai/rateLimit";

type GeneratedCard = { front: string; back: string };
// POST /api/srs/generate — read a note via the AI provider, return drafts (no save)
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  // Shared per-user cap across all six AI routes — before any Groq work.
  const rateLimit = checkAiRateLimit(user.id);
  if (!rateLimit.allowed) {
    return json(
      { data: null, error: aiRateLimitMessage(rateLimit.retryAfterSeconds) },
      429,
      aiRateLimitHeaders(rateLimit.retryAfterSeconds)
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ data: null, error: "Invalid JSON body" }, 400);
  }

  const noteId = typeof body.note_id === "string" ? body.note_id : "";
  if (!noteId) return json({ data: null, error: "note_id is required" }, 400);

  // Optional desired card count (clamp 5–30; default 8 if absent/invalid).
  const rawCount =
    typeof body.cardCount === "number" ? body.cardCount : NaN;
  const cardCount = Number.isFinite(rawCount)
    ? Math.min(30, Math.max(5, Math.round(rawCount)))
    : 8;

  // Fetch the note (RLS scopes to the user; also explicit-check ownership).
  const { data: note, error: noteError } = await supabase
    .from("notes")
    .select("title, content, user_id")
    .eq("id", noteId)
    .single();

  if (noteError || !note || note.user_id !== user.id) {
    return json({ data: null, error: "Note not found" }, 404);
  }

  try {
    // The free text here comes from the DATABASE, not the request body — notes
    // have no length limit on write, so this is the bound on what reaches the
    // model. Truncated rather than rejected: the note is already saved and the
    // user can't shorten it from this screen, and cards from the first
    // MAX_SOURCE_CHARS are more useful than an error. NOTE: real notes now
    // exceed 32,000 chars (YouTube imports), so for those this slice DOES
    // bite, silently — see MAX_SOURCE_CHARS in lib/ai/client.ts.
    const cards = await generateFlashcardsFromNote(
      note.title,
      note.content.slice(0, MAX_SOURCE_CHARS),
      cardCount
    );
    return json<GeneratedCard[]>({ data: cards, error: null });
  } catch (err) {
    console.error("AI generate error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate cards.";
    // "Too short" is a user-fixable validation issue → 400 with the real
    // message. Everything else (AI/parse/network) → generic 500.
    if (message.startsWith("Note is too short")) {
      return json({ data: null, error: message }, 400);
    }
    return json(
      { data: null, error: "Failed to generate cards. Try again." },
      500
    );
  }
}
