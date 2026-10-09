import { json } from "@/lib/api/response";
import { aiRateLimitHeaders } from "@/lib/ai/rateLimit";
import { readBody, requireLearner, uuidParam } from "@/lib/learning/guard";
import { getTopicDetail, runPlan } from "@/lib/learning/reads";
import type { TopicDetail } from "@/lib/learning/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST /api/learning/topics/plan { topicId } — plan again a topic that is still "planning" or "failed". */
export async function POST(request: Request) {
  const learner = await requireLearner();
  if (learner instanceof Response) return learner;
  const { supabase, user } = learner;
  const topicId = uuidParam((await readBody(request))?.topicId);
  if (!topicId) return json({ data: null, error: "No topic was given." }, 400);

  const { data: topic } = await supabase
    .from("learning_topics")
    .select("*")
    .eq("id", topicId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!topic) return json({ data: null, error: "That topic could not be found." }, 404);

  const outcome = topic.status === "active" ? { kind: "planned" as const } : await runPlan(supabase, user.id, topic);
  const detail = await getTopicDetail(supabase, user.id, topicId);
  if (!detail) return json({ data: null, error: "Could not read the topic back." }, 500);
  if (outcome.kind === "waiting") {
    return json<TopicDetail & { retryAfterSeconds: number }>(
      { data: { ...detail, retryAfterSeconds: outcome.retryAfterSeconds }, error: null },
      200,
      aiRateLimitHeaders(outcome.retryAfterSeconds)
    );
  }
  return json<TopicDetail>({ data: detail, error: null });
}
