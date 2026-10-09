import { json } from "@/lib/api/response";
import { aiRateLimitHeaders } from "@/lib/ai/rateLimit";
import { TOPIC_TITLE_MAX } from "@/lib/learning/constants";
import { readBody, requireLearner } from "@/lib/learning/guard";
import { getTopicDetail, runPlan } from "@/lib/learning/reads";
import type { TopicDetail } from "@/lib/learning/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/learning/topics/create { title } — save the topic, then plan it.
 *
 * The topic row is inserted FIRST, before any AI call, so what Udit typed is
 * kept even if planning is refused or fails; the topic then shows as
 * "planning" or "failed" with a Try again. One plan call (~1-3s) and the step
 * rows; lessons are written by /api/learning/advance, which the topic screen
 * starts calling straight away.
 */
export async function POST(request: Request) {
  const learner = await requireLearner();
  if (learner instanceof Response) return learner;
  const { supabase, user } = learner;

  const body = await readBody(request);
  const title = typeof body?.title === "string" ? body.title.replace(/\s+/g, " ").trim() : "";
  if (!title) return json({ data: null, error: "Type a topic first." }, 400);
  if (title.length > TOPIC_TITLE_MAX) {
    return json({ data: null, error: `Keep the topic under ${TOPIC_TITLE_MAX} characters.` }, 400);
  }

  const { data: topic, error } = await supabase
    .from("learning_topics")
    .insert({ user_id: user.id, title, status: "planning" })
    .select("*")
    .single();
  if (error || !topic) {
    console.error("[learning] topic insert failed:", error?.message);
    return json({ data: null, error: "Could not save the topic. Try again." }, 500);
  }

  const outcome = await runPlan(supabase, user.id, topic);
  const detail = await getTopicDetail(supabase, user.id, topic.id);
  if (!detail) return json({ data: null, error: "Could not read the topic back." }, 500);
  if (outcome.kind === "waiting") {
    // Saved, not planned. 200 with the topic: the screen shows "planning" and
    // retries /plan after the wait. The text is not lost either way.
    return json<TopicDetail & { retryAfterSeconds: number }>(
      { data: { ...detail, retryAfterSeconds: outcome.retryAfterSeconds }, error: null },
      200,
      aiRateLimitHeaders(outcome.retryAfterSeconds)
    );
  }
  return json<TopicDetail>({ data: detail, error: null });
}
