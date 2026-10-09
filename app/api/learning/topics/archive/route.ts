import { json } from "@/lib/api/response";
import { readBody, requireLearner, uuidParam } from "@/lib/learning/guard";

export const runtime = "nodejs";

/**
 * POST /api/learning/topics/archive { topicId, archived } — hide or bring back
 * a topic. There is no delete: the table has no DELETE policy (decision 8).
 */
export async function POST(request: Request) {
  const learner = await requireLearner();
  if (learner instanceof Response) return learner;
  const body = await readBody(request);
  const topicId = uuidParam(body?.topicId);
  if (!topicId) return json({ data: null, error: "No topic was given." }, 400);
  const archived = body?.archived !== false;

  const { data, error } = await learner.supabase
    .from("learning_topics")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", topicId)
    .eq("user_id", learner.user.id)
    .select("id, archived_at")
    .maybeSingle();
  if (error) return json({ data: null, error: "Could not update the topic." }, 500);
  if (!data) return json({ data: null, error: "That topic could not be found." }, 404);
  return json({ data, error: null });
}
