import { NextResponse } from "next/server";
import Groq from "groq-sdk";

import { createClient } from "@/lib/supabase/server";

// Same Groq setup as lib/ai/client.ts. That module exports flashcard helpers
// with their own prompts and keeps its client private, so we instantiate one
// here for the reformat-specific system prompt rather than modifying it.
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });
const MODEL = "llama-3.3-70b-versatile";

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
    });
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
