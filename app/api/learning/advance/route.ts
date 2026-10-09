import { json } from "@/lib/api/response";
import {
  aiRateLimitHeaders,
  aiRateLimitMessage,
  checkLearningAdvanceRateLimit,
} from "@/lib/ai/rateLimit";
import { readBody, requireLearner, uuidParam } from "@/lib/learning/guard";
import { advanceTopic } from "@/lib/learning/job";
import type { AdvanceResult } from "@/lib/learning/types";

export const runtime = "nodejs";
// One lesson per request: search ~2s + fetch 3-6s + write 2-5s, measured.
export const maxDuration = 60;

/**
 * POST /api/learning/advance { topicId, stepId? } — write at most one lesson.
 * See lib/learning/job.ts. `stepId` is the step on screen, written first if
 * it has no lesson yet.
 *
 * Every outcome is a 200 with a `kind`, including "waiting" and "failed":
 * they are states of the job the screen shows, not errors of this request.
 * Only a malformed request or this route's own limiter answer otherwise.
 */
export async function POST(request: Request) {
  const learner = await requireLearner();
  if (learner instanceof Response) return learner;
  const { supabase, user } = learner;

  const rate = checkLearningAdvanceRateLimit(user.id);
  if (!rate.allowed) {
    return json(
      { data: null, error: aiRateLimitMessage(rate.retryAfterSeconds) },
      429,
      aiRateLimitHeaders(rate.retryAfterSeconds)
    );
  }

  const body = await readBody(request);
  const topicId = uuidParam(body?.topicId);
  if (!topicId) return json({ data: null, error: "No topic was given." }, 400);
  const stepId = uuidParam(body?.stepId);

  const result = await advanceTopic(supabase, user.id, topicId, stepId);
  if (result.kind === "not_found") return json({ data: null, error: "That topic could not be found." }, 404);
  return json<AdvanceResult>({ data: result, error: null });
}
