import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { istCivilDateToNoonIso, istDateString } from "@/lib/date";
import { EmptyGenerationError, splitCaptureIntoTasks } from "@/lib/ai/client";
import { checkAiRateLimit } from "@/lib/ai/rateLimit";
import {
  MAX_SPLIT_INPUT_CHARS,
  MAX_SPLIT_TASKS,
  type SplitFallbackReason,
  type SplitTasksResult,
} from "@/lib/task-split";
import type { Database, Task } from "@/types/database";

type TaskInsert = Database["public"]["Tables"]["tasks"]["Insert"];
type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

/** The Groq round-trip runs inside POST, so give it room past the 10s default. */
export const maxDuration = 30;

/**
 * POST /api/tasks/split — read one capture, create the tasks it describes.
 *
 * WHY THIS IS A SEPARATE ROUTE. POST /api/tasks is the path every other
 * creation surface in the app uses — TaskForm, the offline replay, the
 * recurring cron's cousin — and it is deliberately untouched by this feature.
 * A capture that shows no sign of holding more than one task never reaches
 * here at all: the client heuristic (lib/task-split.ts) keeps it on the plain
 * path, where it costs no AI call and no rate-limit budget and behaves exactly
 * as it did before this existed.
 *
 * THE ONE GUARANTEE. Given an authenticated caller and a non-empty `text`, this
 * route creates AT LEAST ONE task. Every way the AI can fail to answer — an
 * empty answer, a technical failure, our own rate limit, an over-long input —
 * degrades to a single task holding the literal capture with due_date null,
 * which is precisely what the plain path would have produced. That is not
 * politeness: CaptureField clears its input the instant you press Enter, so a
 * response that creates nothing has destroyed text the user can no longer see.
 * The same reasoning MAX_WORKOUT_REQUESTS_PER_WINDOW documents for the workout
 * route, which is why the rate-limit branch here degrades rather than 429s.
 *
 * NO CONFIRMATION STEP, by decision. Tasks are trivial to edit or delete, and a
 * "does this look right?" screen would cost the speed the capture field exists
 * for. The split is reported in the toast, not reviewed.
 */
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

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return json({ data: null, error: "Nothing to capture" }, 400);

  /** Today, IST — the anchor the model resolves "tomorrow"/"friday" against. */
  const today = istDateString();

  /**
   * Everything below decides ONE thing: the list of {title, due_date} to
   * insert. `fallback` records why the AI didn't decide it, and stays null when
   * it did.
   */
  let drafts: { title: string; due_date: string | null }[];
  let fallback: SplitFallbackReason | null = null;

  /** The floor. Exactly what POST /api/tasks would have stored. */
  const literal = [{ title: text, due_date: null }];

  if (text.length > MAX_SPLIT_INPUT_CHARS) {
    // The client's heuristic already declines above this bound, so reaching
    // here means a caller ignored it. Degrade rather than reject: the capture
    // is still a perfectly good task.
    drafts = literal;
    fallback = "too_long";
  } else {
    // The SHARED 20/60s interactive tier — the same single budget
    // notes/reformat, srs/generate, pdf/analyze, youtube/analyze and
    // youtube/notes/start draw on. Deliberately not a new tier: this is one
    // hand-driven request making one Groq call, which is exactly the shape that
    // budget was sized for.
    //
    // Checked only on the branch that can actually reach Groq, so an over-long
    // capture doesn't spend a slot it was never going to use.
    const rateLimit = checkAiRateLimit(user.id);
    if (!rateLimit.allowed) {
      drafts = literal;
      fallback = "rate_limited";
    } else {
      try {
        drafts = await splitCaptureIntoTasks(text, today);
      } catch (err) {
        // The taxonomy lib/ai/client.ts draws, carried through unchanged:
        // EmptyGenerationError means the call SUCCEEDED and the model found
        // nothing actionable — not a failure, and a retry would find nothing
        // either. Anything else is a real failure. Both produce the same task;
        // only the reported reason differs, and the client only apologises for
        // the second.
        if (err instanceof EmptyGenerationError) {
          fallback = "empty";
        } else {
          console.error("Task split failed, creating literal task:", err);
          fallback = "ai_failed";
        }
        drafts = literal;
      }
    }
  }

  // A model that returns thirty items from one line has misread the capture.
  // Keep the first MAX_SPLIT_TASKS and SAY SO, rather than silently filling the
  // task list from a single paste or throwing away work the user did ask for.
  const truncated = drafts.length > MAX_SPLIT_TASKS;
  const kept = truncated ? drafts.slice(0, MAX_SPLIT_TASKS) : drafts;

  // One insert for the whole capture — the same shape POST /api/workouts uses
  // to write a session's sets: the capture is one user action, so it is one
  // round trip that either lands or doesn't.
  const rows: TaskInsert[] = kept.map((d) => ({
    user_id: user.id,
    title: d.title,
    description: null,
    status: "todo",
    priority: "medium",
    // The model hands back a plain civil date; the noon-IST anchoring is done
    // here, by the same helper the rest of the app's day-level date handling
    // uses. The AI never sees or produces a timestamp.
    due_date: d.due_date ? istCivilDateToNoonIso(d.due_date) : null,
    plan_id: null,
    completed_at: null,
  }));

  const { data, error } = await supabase
    .from("tasks")
    .insert(rows)
    .select()
    .order("created_at", { ascending: true });

  if (error) return json({ data: null, error: error.message }, 500);

  return json<SplitTasksResult<Task>>(
    { data: { tasks: data ?? [], fallback, truncated }, error: null },
    201
  );
}
