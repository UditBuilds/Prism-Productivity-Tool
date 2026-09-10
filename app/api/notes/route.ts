import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { markdownExcerpt } from "@/lib/markdown";
import { summarizeNoteContent } from "@/lib/ai/client";
import { checkAiRateLimit } from "@/lib/ai/rateLimit";
import { needsSummary } from "@/lib/notes/revisit-summary";
import type { Database, Note } from "@/types/database";

type NoteUpdate = Database["public"]["Tables"]["notes"]["Update"];

type ApiResponse<T> = { data: T | null; error: string | null };

/**
 * The Revisit summary for a note about to be written, or null.
 *
 * SYNCHRONOUS AND INSIDE THE SAVE, on purpose. The dashboard's Revisit section
 * is a Server Component: there is no client to kick a background job from and
 * no second render to fill in later, so a summary that isn't written by the
 * time the save returns would only appear on some later edit. Generating here
 * means the row is correct the first time the dashboard reads it.
 *
 * NEVER FATAL. A Groq failure — the 8,000 TPM ceiling, a bad key, a
 * decommissioned model — returns null and the note saves without a summary.
 * The widget then renders a truncated excerpt (lib/notes/revisit-summary.ts),
 * which is the whole reason that fallback exists. Losing a user's note text
 * because a summarizer was rate-limited would be a far worse bug than the one
 * this feature fixes.
 *
 * RATE-LIMITED, BUT NEVER BY REJECTING THE SAVE. This was the one Groq-reaching
 * route with no frequency cap, so a runaway client loop could drive unbounded
 * Groq calls through it. It now shares the same 20/60s per-user budget as the
 * other AI routes — but it CANNOT answer 429 the way notes/reformat does.
 *
 * A 429 here would destroy the user's note, and the failure is already fully
 * diagnosed in MAX_WORKOUT_REQUESTS_PER_WINDOW (lib/ai/rateLimit.ts): both
 * createNote and updateNote are offline-resumable (lib/offline-mutations.ts),
 * `request()` in hooks/useNotes.ts throws on ANY non-OK response, so a 429 is
 * indistinguishable from a network failure to the retryer, and mutations
 * retry 3x with ~1s/2s/4s backoff (app/providers.tsx) — all four attempts land
 * inside the SAME 60s window and all fail. useCreateNote's onError then rolls
 * the optimistic row back. Four rejections, note gone.
 *
 * So the cap degrades instead: past the ceiling the summary is skipped and the
 * note saves without one. That is the pattern /api/tasks/split already uses
 * for the same shared limiter (its `fallback = "rate_limited"` branch) — bound
 * the Groq spend, keep the user's input.
 *
 * The slot is consumed ONLY on the path that actually calls Groq. A burst of
 * Spark notes returns above the check and spends nothing, so it cannot starve
 * the reformat and flashcard routes that share the budget.
 *
 * Returns `undefined` to mean "leave the stored value alone".
 */
async function summaryForSave({
  userId,
  kind,
  title,
  content,
  regenerate,
}: {
  /** Whose shared AI budget this summary is charged against. */
  userId: string;
  kind: "spark" | "revisit" | null;
  title: string;
  content: string;
  /** False when nothing changed that could invalidate an existing summary. */
  regenerate: boolean;
}): Promise<string | null | undefined> {
  if (!regenerate) return undefined;

  // Short, or not a Revisit note: no summary is shown for it, so clear any
  // stale one rather than leaving a summary of text that no longer exists.
  if (kind !== "revisit" || !needsSummary(content)) return null;

  // Everything below this line reaches Groq, so this is where a slot is spent.
  const rateLimit = checkAiRateLimit(userId);
  if (!rateLimit.allowed) {
    console.warn(
      `[notes] AI budget exhausted; saving without a summary (retry in ${rateLimit.retryAfterSeconds}s)`
    );
    // null, NOT undefined, on purpose — the same choice the catch below makes.
    // Leaving the old value would pin a summary of text that no longer exists,
    // and the self-healing clause in PATCH only regenerates when the stored
    // summary is empty, so a stale one would never be replaced. Null shows the
    // excerpt fallback now and picks up a real summary on the next save.
    return null;
  }

  try {
    return await summarizeNoteContent(title, content);
  } catch (err) {
    console.error("[notes] summary generation failed; saving without one", err);
    return null;
  }
}

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

/** Normalize an incoming tags value into a clean, de-duped string array. */
function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter(Boolean);
  return Array.from(new Set(cleaned));
}

// GET /api/notes — all notes for the authed user
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) return json({ data: null, error: error.message }, 500);
  return json<Note[]>({ data: data ?? [], error: null });
}

// POST /api/notes — create
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

  let title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content : "";

  // Capture kinds (spark/revisit) don't require a title. Revisit derives one
  // from the text (its dashboard card leads with a title); Spark stays
  // untitled — the body IS the note, and a derived title would just duplicate
  // it on the card. Legacy calls (no kind) keep the original requirement.
  const kind =
    body.kind === "spark" || body.kind === "revisit" ? body.kind : null;
  if (kind) {
    if (!title && kind === "revisit") title = markdownExcerpt(content, 60);
    if (!title && !content.trim()) {
      return json({ data: null, error: "Note is empty" }, 400);
    }
  } else if (!title) {
    return json({ data: null, error: "Title is required" }, 400);
  }

  const summary = await summaryForSave({
    userId: user.id,
    kind,
    title,
    content,
    regenerate: true,
  });

  const { data, error } = await supabase
    .from("notes")
    .insert({
      user_id: user.id,
      title,
      content,
      tags: parseTags(body.tags),
      kind,
      summary: summary ?? null,
    })
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  return json<Note>({ data, error: null }, 201);
}

// PATCH /api/notes — update (RLS guarantees ownership)
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
  if (!id) return json({ data: null, error: "Note id is required" }, 400);

  const updates: NoteUpdate = {};
  if (body.title !== undefined) {
    // Empty is allowed — untitled Sparks round-trip through the edit modal
    // with title "". The modal still requires a title for every other kind.
    updates.title =
      typeof body.title === "string" ? body.title.trim() : "";
  }
  if (body.content !== undefined) {
    updates.content = typeof body.content === "string" ? body.content : "";
  }
  if (body.tags !== undefined) {
    updates.tags = parseTags(body.tags);
  }
  // Kind is switchable between Spark and Revisit only. Anything else (incl.
  // "recall", which is never stored on a note) is ignored — the DB CHECK
  // constraint is the backstop.
  if (body.kind === "spark" || body.kind === "revisit") {
    updates.kind = body.kind;
  }

  if (Object.keys(updates).length === 0) {
    return json({ data: null, error: "No fields to update" }, 400);
  }

  /**
   * Read the row before writing it, so the summary decision can be made
   * against what the note will actually BE after this patch — not against the
   * fragment of it this request happens to carry.
   *
   * A PATCH may send content without kind (an edit), kind without content (the
   * Spark/Revisit switcher), or a title alone. Each of those changes the
   * answer, and only the merged row knows it. RLS scopes the select to the
   * caller, so a miss here is a genuine 404.
   */
  const { data: existing } = await supabase
    .from("notes")
    .select("kind, title, content, summary")
    .eq("id", id)
    .maybeSingle();

  if (existing) {
    const nextKind = updates.kind ?? existing.kind;
    const nextTitle = updates.title ?? existing.title;
    const nextContent = updates.content ?? existing.content ?? "";
    const contentChanged =
      updates.content !== undefined && updates.content !== existing.content;

    /**
     * Regenerate when the text changed, when the note just became a Revisit,
     * or when a note that should have a summary is missing one.
     *
     * That last clause is what makes this self-healing: a note whose earlier
     * generation failed, or one written by a path that doesn't summarize (the
     * YouTube job's finalize insert), picks one up on its next save instead of
     * showing the excerpt fallback forever. It also keeps the common case
     * free — re-saving an unchanged note that already has a summary fires no
     * Groq call at all.
     */
    const regenerate =
      contentChanged ||
      (updates.kind !== undefined && updates.kind !== existing.kind) ||
      (nextKind === "revisit" &&
        needsSummary(nextContent) &&
        !existing.summary);

    const summary = await summaryForSave({
      userId: user.id,
      kind: nextKind,
      title: nextTitle,
      content: nextContent,
      regenerate,
    });
    if (summary !== undefined) updates.summary = summary;
  }

  // Touch updated_at so the list re-sorts to the top after an edit.
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("notes")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  if (!data) return json({ data: null, error: "Note not found" }, 404);
  return json<Note>({ data, error: null });
}

// DELETE /api/notes — delete by id (RLS guarantees ownership)
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
  if (!id) return json({ data: null, error: "Note id is required" }, 400);

  const { error } = await supabase.from("notes").delete().eq("id", id);
  if (error) return json({ data: null, error: error.message }, 500);
  return json<{ id: string }>({ data: { id }, error: null });
}
