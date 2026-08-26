import { NextResponse } from "next/server";
import Groq, { APIError, RateLimitError } from "groq-sdk";

import { createClient } from "@/lib/supabase/server";
import {
  aiRateLimitHeaders,
  aiRateLimitMessage,
  checkAiRateLimit,
} from "@/lib/ai/rateLimit";

// Same Groq setup as lib/ai/client.ts. That module exports flashcard helpers
// with their own prompts and keeps its client private, so we instantiate one
// here for the reformat-specific system prompt rather than modifying it.
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });
const MODEL = "openai/gpt-oss-120b";

/**
 * Longest `content` this route will accept.
 *
 * This is the one Groq path whose free text arrives straight from the request
 * body with no upstream bound — /api/srs/generate reads the note from the DB,
 * and the PDF and YouTube routes chunk before generating. So the cap belongs
 * here, at the door.
 *
 * REJECTED, never truncated. The system prompt's contract is "preserve every
 * single word" and the result is written back over the note, so trimming the
 * input would delete the tail of the user's note under the guise of
 * formatting it. Sized from the live database — the largest note is 18,656
 * characters — so no existing note is turned away.
 */
const MAX_CONTENT_CHARS = 24000;

/**
 * Output ceiling. Reformatting returns the input plus markdown syntax, so the
 * completion tracks the input's size: 24,000 chars in is roughly 6,000 tokens,
 * and 8,000 leaves room for the added headers, bullets and blank lines.
 */
const MAX_TOKENS = 8000;

/**
 * Groq refuses an over-budget request in TWO different ways, and they need
 * DIFFERENT advice — which is the whole point of this block. Both shapes below
 * were observed from real calls on 2026-08-26, not inferred from the docs.
 *
 * 1. HTTP 413, plain `APIError` — "Request too large … TPM: Limit 8000,
 *    Requested 12820, please reduce your message size". One request whose
 *    prompt + max_tokens exceeds the account's ENTIRE per-minute budget.
 *    DETERMINISTIC: the same note fails every time, so "Try again" is a lie.
 *    The only fix available to the user is a shorter note.
 *
 * 2. HTTP 429, `RateLimitError` — "Rate limit reached … Used 7402, Requested
 *    1069. Please try again in 3.5s". The budget was spent by RECENT calls.
 *    TRANSIENT: waiting genuinely fixes it.
 *
 * Two traps worth knowing before touching this:
 *
 * - `instanceof RateLimitError` is FALSE for case 1. The oversized-request
 *   error arrives as a bare `APIError` with status 413 even though its JSON
 *   body says `"code":"rate_limit_exceeded"`. Matching only on RateLimitError
 *   — the obvious implementation — silently misses the case this route is
 *   most exposed to.
 * - The SDK does NOT lift the body's `code`/`type` onto the error object:
 *   `err.code` and `err.type` are both `undefined` in each case. Only
 *   `err.status` is reliable, so that is what we branch on.
 *
 * Why this route and not the other five: reformat pairs a 24,000-char input
 * allowance with `max_tokens: 8000`, and Groq reserves prompt + max_tokens up
 * front, so a large note can exceed the 8,000 TPM budget in a SINGLE call. The
 * other five either chunk before generating or carry far smaller per-call
 * ceilings — see the PR for the per-route arithmetic.
 */
function capacityFailure(
  err: unknown
): { message: string; status: number; retryAfter?: string } | null {
  if (!(err instanceof APIError)) return null;

  // Case 1 — one request bigger than the whole per-minute budget.
  if (err.status === 413) {
    return {
      message:
        "This note is too large for the AI's current capacity, so nothing was saved. Split it into smaller notes and reformat them separately.",
      status: 413,
    };
  }

  // Case 2 — budget spent by recent activity; retrying later works.
  if (err instanceof RateLimitError || err.status === 429) {
    // Groq's retry-after is usually a small number of seconds (1 and 4 both
    // observed), so the singular case is common enough to be worth getting
    // right rather than shipping "in about 1 seconds".
    const retryAfter = err.headers?.get("retry-after") ?? undefined;
    const seconds = Number(retryAfter);
    const wait =
      retryAfter && Number.isFinite(seconds) && seconds > 0
        ? ` Try again in about ${retryAfter} second${seconds === 1 ? "" : "s"}.`
        : " Try again shortly.";
    return {
      message: `The AI is at capacity right now, so nothing was saved.${wait}`,
      status: 429,
      retryAfter,
    };
  }

  return null;
}

export const runtime = "nodejs";
export const maxDuration = 60;

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(
  body: ApiResponse<T>,
  status = 200,
  headers?: Record<string, string>
) {
  return NextResponse.json(body, { status, headers });
}

const SYSTEM_PROMPT = `You are a markdown formatter. Add proper markdown structure to raw unformatted text.

STRICT RULES:
- Preserve every single word exactly as-is. Never add, remove, or paraphrase anything.
- Add ## for main section headers
- Add ### for subsection headers
- Convert run-together bullet items into proper - list items on separate lines
- Add blank lines between paragraphs and sections for breathing room
- Use **bold** where strong emphasis is clearly intended
- Use backtick code formatting for technical terms, commands, or variable names
- Format clear tables as markdown tables
- Return ONLY the formatted markdown. No explanation. No preamble. No closing note.`;

/** Strip a wrapping ```markdown … ``` fence the model may add despite the rules. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1].trim() : trimmed;
}

// POST /api/notes/reformat — AI-add markdown structure to a note's content.
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

  const noteId = typeof body.noteId === "string" ? body.noteId : "";
  const content = typeof body.content === "string" ? body.content : "";
  if (!noteId) return json({ data: null, error: "noteId is required" }, 400);
  if (!content.trim()) {
    return json({ data: null, error: "Note has no content to reformat" }, 400);
  }
  if (content.length > MAX_CONTENT_CHARS) {
    return json(
      {
        data: null,
        error: `Note is too long to reformat (${content.length.toLocaleString()} characters, max ${MAX_CONTENT_CHARS.toLocaleString()}). Split it into smaller notes first.`,
      },
      413
    );
  }

  // --- Groq first: never touch the DB unless formatting succeeds ----------
  let formatted: string;
  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content },
      ],
      temperature: 0.3,
      max_tokens: MAX_TOKENS,
    });
    // A completion that stopped at the token ceiling is a PARTIAL note, and
    // the next statement writes this over the user's content. Bail out — the
    // note is worth more than the formatting. This check is why adding
    // max_tokens here is safe at all.
    if (completion.choices[0]?.finish_reason === "length") {
      return json(
        {
          data: null,
          error:
            "The formatted note came back incomplete, so nothing was saved. Try a shorter note.",
        },
        502
      );
    }
    formatted = stripCodeFence(completion.choices[0]?.message?.content ?? "");
  } catch (err) {
    console.error("Note reformat (Groq) failed:", err);
    // Capacity refusals get their own wording; everything else keeps the
    // generic 502 below, unchanged.
    const capacity = capacityFailure(err);
    if (capacity) {
      return json(
        { data: null, error: capacity.message },
        capacity.status,
        capacity.retryAfter ? { "Retry-After": capacity.retryAfter } : undefined
      );
    }
    return json({ data: null, error: "AI formatting failed. Try again." }, 502);
  }

  if (!formatted) {
    return json(
      { data: null, error: "AI returned empty output. Try again." },
      502
    );
  }

  // --- Persist (RLS + explicit user scope; updated_at via the notes trigger).
  const { error } = await supabase
    .from("notes")
    .update({ content: formatted })
    .eq("id", noteId)
    .eq("user_id", user.id);

  if (error) return json({ data: null, error: error.message }, 500);

  return json<{ content: string }>({
    data: { content: formatted },
    error: null,
  });
}
