import { json } from "@/lib/api/response";
import { WRONG_NOTE_MAX } from "@/lib/learning/constants";
import { readBody, requireLearner, uuidParam } from "@/lib/learning/guard";
import type { StepAction } from "@/lib/learning/types";
import type { Database } from "@/types/database";

export const runtime = "nodejs";

const ACTIONS: StepAction[] = ["open", "remove", "restore", "redo", "wrong", "retry"];

/**
 * POST /api/learning/steps/update { stepId, action, note? }
 *
 *   open    — the lesson was shown; moves the one-ahead reading point
 *   remove  — mark removed (decision 8: never a hard delete); restore undoes it
 *   redo    — write this step's lesson again
 *   wrong   — "This is wrong": write it again, with Udit's optional note
 *   retry   — "Try again" on a failed step
 *
 * None of these call the AI. They only change what /api/learning/advance
 * will do next, so they are cheap and can never lose a lesson: rewriting
 * adds a new lesson row and the old one stays until the new one is saved.
 */
export async function POST(request: Request) {
  const learner = await requireLearner();
  if (learner instanceof Response) return learner;
  const { supabase, user } = learner;
  const body = await readBody(request);
  const stepId = uuidParam(body?.stepId);
  const action = ACTIONS.find((a) => a === body?.action);
  if (!stepId || !action) return json({ data: null, error: "No step or action was given." }, 400);

  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (note.length > WRONG_NOTE_MAX) {
    return json({ data: null, error: `Keep the note under ${WRONG_NOTE_MAX} characters.` }, 400);
  }

  const { data: step } = await supabase
    .from("learning_steps")
    .select("id, status, opened_at, removed_at")
    .eq("id", stepId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!step) return json({ data: null, error: "That step could not be found." }, 404);

  let patch: Database["public"]["Tables"]["learning_steps"]["Update"] | null = null;
  switch (action) {
    case "open":
      patch = step.opened_at ? null : { opened_at: new Date().toISOString() };
      break;
    case "remove":
      patch = { removed_at: step.removed_at ?? new Date().toISOString() };
      break;
    case "restore":
      patch = { removed_at: null };
      break;
    case "redo":
    case "wrong":
      if (step.status === "writing") {
        return json({ data: null, error: "This lesson is being written right now. Try again in a moment." }, 409);
      }
      patch = {
        status: "pending",
        rewrite_reason: action,
        rewrite_note: action === "wrong" && note ? note : null,
        error_code: null,
        error_message: null,
      };
      break;
    case "retry":
      if (step.status !== "failed") return json({ data: { stepId }, error: null });
      patch = { status: "pending", error_code: null, error_message: null };
      break;
  }

  if (patch) {
    const { error } = await supabase.from("learning_steps").update(patch).eq("id", stepId).eq("user_id", user.id);
    if (error) {
      console.error("[learning] step update failed:", error.message);
      return json({ data: null, error: "Could not update the step. Try again." }, 500);
    }
  }
  return json({ data: { stepId }, error: null });
}
