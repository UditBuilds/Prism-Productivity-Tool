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
 * formatting it.
 *
 * WHY 24,000 SURVIVES, now measured against the budget rather than the corpus.
 * The original note here said this was sized so that "no existing note is
 * turned away" because "the largest note is 18,656 characters". That is no
 * longer true of the corpus — as of 2026-09-10 the live table holds a 37,772
 * and a 114,787-character note, so two real notes ARE turned away, by design;
 * neither is reformattable at any cap this account can afford.
 *
 * What justifies the number now is the token arithmetic, measured 2026-09-10
 * against REAL note text from the live table:
 *
 *   fixed overhead (SYSTEM_PROMPT + chat scaffolding) = 211 tokens
 *   real note prose = 4.43 chars/token (consistent at 14,000 and 24,000 chars)
 *
 * AT THE CAP, MEASURED DIRECTLY: 24,000 chars of real note prose is
 * prompt_tokens = 5,633 and returns 200 — 2,367 tokens (~30%) clear of the
 * 8,000 TPM ceiling. The `chars / 4` estimator used by capacityFailure() puts
 * it at 6,211, still inside the limit, so the estimate errs high and stays
 * safe.
 *
 * So a max-size note is admissible whenever the minute's budget is not already
 * spent — which is exactly the property capacityFailure() below reports on.
 *
 * If you re-measure this, do it on a RESTED budget. A bucket in debt refuses
 * an in-cap note with a size-shaped 413 (see capacityFailure), which reads as
 * "the cap is too high" when it is nothing of the sort. Repeated-sentence
 * filler is fine for tokenisation (~4.5 chars/token, close to real prose) but
 * tells you nothing about admission, which is what actually varies.
 */
const MAX_CONTENT_CHARS = 24000;

/**
 * Output ceiling. Reformatting returns the input plus markdown syntax, so the
 * completion tracks the input's size: 24,000 chars in is roughly 6,000 tokens,
 * and 8,000 leaves room for the added headers, bullets and blank lines.
 *
 * IT DOES NOT COST BUDGET UP FRONT — do not "tune this down to buy headroom".
 * Groq admits a request on `used + prompt_tokens <= limit`; max_tokens is not
 * reserved. Measured 2026-09-10 against this account: 166 chars @ max_tokens
 * 8000 returned 200 and was charged 545 total, and 200 chars @ max_tokens
 * 30000 — nearly 4x the entire 8,000 TPM limit — also returned 200, charged
 * 332. A depleted-budget refusal reports `Requested 4877` for a ~4,540-token
 * prompt, i.e. the prompt alone.
 *
 * This REPLACES the older `prompt_tokens + max_tokens` reservation model still
 * described in CLAUDE.md's Groq section; that model was real when it was
 * recorded (the 2026-08-26 refusal quoted `Requested 12820`, exactly
 * prompt+8000) and Groq has since changed it. Lowering this number therefore
 * buys no capacity at all — it only risks the finish_reason "length" bail-out
 * below on a long note. Actual completions are nowhere near the cap: 554
 * tokens for a 20,000-char note, 201 for a small one.
 */
const MAX_TOKENS = 8000;

/**
 * The account's per-minute token ceiling, and a prompt-size estimate to compare
 * against it. Both exist so capacityFailure() can tell "this can never fit"
 * apart from "the minute is spent" WITHOUT trying to reverse-engineer Groq's
 * arithmetic — see there for why that matters.
 *
 * TPM_LIMIT mirrors `x-ratelimit-limit-tokens`, confirmed 8000 on this account
 * (free tier, account-wide, same for every model). The estimator is measured,
 * not assumed: 211 tokens of fixed overhead (SYSTEM_PROMPT + chat scaffolding)
 * plus real note prose at 4.3-4.9 chars/token, rounded DOWN to 4 so the
 * estimate errs high and this stays conservative.
 */
const TPM_LIMIT = 8000;
const PROMPT_OVERHEAD_TOKENS = 211;
const estimatePromptTokens = (chars: number) =>
  PROMPT_OVERHEAD_TOKENS + Math.ceil(chars / 4);

/** Groq often states the wait in the body even when the header omits it. */
function retrySecondsFrom(err: APIError): string | undefined {
  const header = err.headers?.get("retry-after") ?? undefined;
  if (header && Number.isFinite(Number(header)) && Number(header) > 0) {
    return header;
  }
  const inBody = String(err.message ?? "").match(/try again in ([\d.]+)s/i);
  if (!inBody) return undefined;
  const rounded = Math.ceil(Number(inBody[1]));
  return Number.isFinite(rounded) && rounded > 0 ? String(rounded) : undefined;
}

/**
 * Turn a Groq capacity refusal into advice the user can act on.
 *
 * THE STATUS CODE DOES NOT TELL YOU THE CAUSE. This is the trap that produced
 * the bug this function exists to fix, and it is worth stating precisely
 * because the obvious reading of Groq's own wording is wrong.
 *
 * Two capacity shapes are confirmed live against this account:
 *
 *   429 "Rate limit reached … Limit 8000, Used 6166, Requested 4877"
 *   413 "Request too large … Limit 8000, Requested 9471"   (no `Used`)
 *
 * The 413 reads as a verdict on the request's size, and the previous version of
 * this function believed it — returning "This note is too large". **That is
 * false.** Measured 2026-09-10: a 24,000-character note returned 200 twice on a
 * full budget and then 413 on a spent one, within the same few minutes. Same
 * note, same max_tokens, opposite answers. So the 413 is contention-dependent,
 * and "split it into smaller notes" is unactionable advice for a note that
 * demonstrably reformats fine a minute later.
 *
 * Nor can the numbers be reasoned about. The 429 reports `Requested` as the
 * prompt alone (5,634 measured for a 24,000-char prompt whose prompt_tokens
 * was 5,633), but a 413 for that same content reported `Requested 9471` —
 * reconcilable with neither the prompt nor prompt+max_tokens. Whatever Groq
 * folds into that figure, it is not something this route should branch on.
 *
 * SO THE NUMBERS FROM GROQ ARE NOT USED AT ALL. The one figure that IS reliable
 * is the one we already hold: `content.length`, bounded by MAX_CONTENT_CHARS at
 * the door above. The question becomes "could this content have fit an EMPTY
 * budget?", answered locally:
 *
 *   - Yes → transient. Recent calls spent the minute; waiting genuinely works.
 *           This is the ONLY case reachable at the current 24,000-char cap
 *           (~6,200 estimated prompt tokens vs. an 8,000 ceiling), and it is
 *           precisely the "budget contention across concurrent requests"
 *           condition — expected behaviour on a shared cap, not a bug here.
 *   - No  → deterministic. Nothing but a shorter note can help.
 *
 * That branch is unreachable today BY CONSTRUCTION, and deliberately kept: it
 * is what kicks in if MAX_CONTENT_CHARS is ever raised past what the tier can
 * admit (roughly 31,000 chars at 8,000 TPM), so raising the cap degrades into
 * honest advice instead of silently lying in the other direction.
 *
 * One SDK trap survives from the original note: `instanceof RateLimitError` is
 * FALSE for the 413 even though its body says `"code":"rate_limit_exceeded"`,
 * and the SDK lifts neither `code` nor `type` onto the error object. Match on
 * `status`, and treat both statuses as the same family.
 */
function capacityFailure(
  err: unknown,
  contentChars: number
): { message: string; status: number; retryAfter?: string } | null {
  if (!(err instanceof APIError)) return null;

  const isCapacity =
    err instanceof RateLimitError || err.status === 429 || err.status === 413;
  if (!isCapacity) return null;

  if (estimatePromptTokens(contentChars) > TPM_LIMIT) {
    return {
      message:
        "This note is too large for the AI's current capacity, so nothing was saved. Split it into smaller notes and reformat them separately.",
      status: 413,
    };
  }

  const retryAfter = retrySecondsFrom(err);
  const seconds = Number(retryAfter);
  // Groq's waits run from under a second to about a minute, so get the
  // singular right rather than shipping "in about 1 seconds".
  const wait =
    retryAfter && Number.isFinite(seconds) && seconds > 0
      ? ` Try again in about ${retryAfter} second${seconds === 1 ? "" : "s"}.`
      : " Try again shortly.";
  return {
    message: `The AI is busy right now, so nothing was saved.${wait}`,
    status: 429,
    retryAfter,
  };
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
    const capacity = capacityFailure(err, content.length);
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
