import { json } from "@/lib/api/response";
import { readBody, requireLearner, uuidParam } from "@/lib/learning/guard";
import { getLessonView } from "@/lib/learning/reads";
import type { LessonView } from "@/lib/learning/types";

export const runtime = "nodejs";

/** POST /api/learning/lesson { stepId } — a read; POST for the reason in lib/learning/reads.ts. */
export async function POST(request: Request) {
  const learner = await requireLearner();
  if (learner instanceof Response) return learner;
  const stepId = uuidParam((await readBody(request))?.stepId);
  if (!stepId) return json({ data: null, error: "No step was given." }, 400);
  const view = await getLessonView(learner.supabase, learner.user.id, stepId);
  if (!view) return json({ data: null, error: "That lesson could not be found." }, 404);
  return json<LessonView>({ data: view, error: null });
}
