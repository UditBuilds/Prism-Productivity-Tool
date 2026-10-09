import { json } from "@/lib/api/response";
import { requireLearner } from "@/lib/learning/guard";
import { listTopics } from "@/lib/learning/reads";
import type { TopicSummary } from "@/lib/learning/types";

export const runtime = "nodejs";

/** POST /api/learning/topics/list — POST so the service worker never caches it (lib/learning/reads.ts). */
export async function POST() {
  const learner = await requireLearner();
  if (learner instanceof Response) return learner;
  try {
    const topics = await listTopics(learner.supabase, learner.user.id);
    return json<{ topics: TopicSummary[] }>({ data: { topics }, error: null });
  } catch (err) {
    return json({ data: null, error: err instanceof Error ? err.message : "Could not read your topics." }, 500);
  }
}
