import { NextResponse } from "next/server";
import Groq from "groq-sdk";

import { createClient } from "@/lib/supabase/server";

// Same Groq setup as lib/ai/client.ts. That module exports flashcard helpers
// with their own prompts and keeps its client private, so we instantiate one
// here for the reformat-specific system prompt rather than modifying it.
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });
const MODEL = "llama-3.3-70b-versatile";

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

export const runtime = "nodejs";
export const maxDuration = 60;

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
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
