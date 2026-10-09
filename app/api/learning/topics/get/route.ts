import { json } from "@/lib/api/response";
import { readBody, requireLearner, uuidParam } from "@/lib/learning/guard";
import { getTopicDetail } from "@/lib/learning/reads";
import type { TopicDetail } from "@/lib/learning/types";

export const runtime = "nodejs";

/** POST /api/learning/topics/get { topicId } — a read; POST for the reason in lib/learning/reads.ts. */
export async function POST(request: Request) {
  const learner = await requireLearner();
  if (learner instanceof Response) return learner;
  const topicId = uuidParam((await readBody(request))?.topicId);
  if (!topicId) return json({ data: null, error: "No topic was given." }, 400);
  const detail = await getTopicDetail(learner.supabase, learner.user.id, topicId);
  if (!detail) return json({ data: null, error: "That topic could not be found." }, 404);
  return json<TopicDetail>({ data: detail, error: null });
}
