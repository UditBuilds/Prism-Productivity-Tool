import type { SupabaseClient } from "@supabase/supabase-js";

import { checkAiRateLimit } from "@/lib/ai/rateLimit";
import { LearningAiError, planTopic } from "@/lib/learning/groq";
import { budgetState, logCall } from "@/lib/learning/ledger";
import { minutesToRead } from "@/lib/learning/lesson-format";
import type {
  LessonView,
  StepSummary,
  TopicDetail,
  TopicSummary,
} from "@/lib/learning/types";
import type { Database, LearningStep, LearningTopic } from "@/types/database";

/**
 * Server-side reads and the planning step, shared by app/api/learning/**.
 *
 * WHY EVERY LEARNING READ IS A POST. The production service worker
 * (@ducanh2912/next-pwa, whose default runtimeCaching next.config.mjs does
 * not override) caches every same-origin GET under /api/ for 24 hours,
 * NetworkFirst, and answers from that cache when the network fails or takes
 * longer than 10 seconds. Learning is online-only (decision 9): offline it
 * must say so, not show yesterday's list as if it were current. The rule
 * only matches GET, so a POST read is never cached and simply fails offline,
 * and the screen shows its offline message. The PWA config is out of bounds
 * for this change, and new GET URLs would also churn the 16-entry cache the
 * other screens' offline copies live in. (The service worker is off in dev,
 * which is why this only shows on a production build.)
 *
 * Reads never write. Opening a lesson is its own POST to /steps/update.
 */

type Client = SupabaseClient<Database>;

function stepSummary(s: LearningStep, hasLesson: boolean): StepSummary {
  return {
    id: s.id,
    position: s.position,
    title: s.title,
    goal: s.goal,
    status: s.status,
    error_code: s.error_code,
    error_message: s.error_message,
    rewrite_reason: s.rewrite_reason,
    opened_at: s.opened_at,
    removed_at: s.removed_at,
    has_lesson: hasLesson,
  };
}

function topicSummary(t: LearningTopic, steps: LearningStep[], withLesson: Set<string>): TopicSummary {
  const active = steps.filter((s) => s.removed_at === null);
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    error_message: t.error_message,
    archived_at: t.archived_at,
    created_at: t.created_at,
    counts: {
      steps: active.length,
      ready: active.filter((s) => withLesson.has(s.id)).length,
      writing: active.filter((s) => s.status === "writing").length,
      failed: active.filter((s) => s.status === "failed").length,
      removed: steps.length - active.length,
    },
  };
}

/** Step ids that have at least one lesson WITH sources (a lesson without is never shown). */
async function stepsWithLessons(supabase: Client, userId: string, stepIds: string[]): Promise<Set<string>> {
  if (stepIds.length === 0) return new Set();
  const { data: lessons } = await supabase
    .from("learning_lessons")
    .select("id, step_id")
    .eq("user_id", userId)
    .in("step_id", stepIds);
  const lessonIds = (lessons ?? []).map((l) => l.id);
  if (lessonIds.length === 0) return new Set();
  const { data: sources } = await supabase
    .from("learning_lesson_sources")
    .select("lesson_id")
    .eq("user_id", userId)
    .in("lesson_id", lessonIds);
  const sourced = new Set((sources ?? []).map((s) => s.lesson_id));
  return new Set((lessons ?? []).filter((l) => sourced.has(l.id)).map((l) => l.step_id));
}

export async function listTopics(supabase: Client, userId: string): Promise<TopicSummary[]> {
  const { data: topics, error } = await supabase
    .from("learning_topics")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error("Could not read your topics.");
  const ids = (topics ?? []).map((t) => t.id);
  const { data: steps } = ids.length
    ? await supabase.from("learning_steps").select("*").eq("user_id", userId).in("topic_id", ids)
    : { data: [] as LearningStep[] };
  const all = steps ?? [];
  const withLesson = await stepsWithLessons(supabase, userId, all.map((s) => s.id));
  return (topics ?? []).map((t) =>
    topicSummary(t, all.filter((s) => s.topic_id === t.id), withLesson)
  );
}

export async function getTopicDetail(supabase: Client, userId: string, topicId: string): Promise<TopicDetail | null> {
  const { data: topic } = await supabase
    .from("learning_topics")
    .select("*")
    .eq("id", topicId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!topic) return null;
  const { data: steps } = await supabase
    .from("learning_steps")
    .select("*")
    .eq("topic_id", topicId)
    .eq("user_id", userId)
    .order("position", { ascending: true });
  const list = steps ?? [];
  const withLesson = await stepsWithLessons(supabase, userId, list.map((s) => s.id));
  return {
    topic: topicSummary(topic, list, withLesson),
    steps: list.map((s) => stepSummary(s, withLesson.has(s.id))),
  };
}

export async function getLessonView(supabase: Client, userId: string, stepId: string): Promise<LessonView | null> {
  const { data: step } = await supabase
    .from("learning_steps")
    .select("*")
    .eq("id", stepId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!step) return null;
  const [{ data: topic }, { data: siblings }, { data: lessons }] = await Promise.all([
    supabase.from("learning_topics").select("id, title").eq("id", step.topic_id).eq("user_id", userId).maybeSingle(),
    supabase
      .from("learning_steps")
      .select("id, position, removed_at")
      .eq("topic_id", step.topic_id)
      .eq("user_id", userId)
      .order("position", { ascending: true }),
    supabase
      .from("learning_lessons")
      .select("*")
      .eq("step_id", stepId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  if (!topic) return null;

  // The newest lesson that has its sources. Normally the newest lesson; an
  // older one only if a save failed between the two inserts.
  const lessonIds = (lessons ?? []).map((l) => l.id);
  const { data: sourceRows } = lessonIds.length
    ? await supabase
        .from("learning_lesson_sources")
        .select("lesson_id, url, title, site_name, position")
        .eq("user_id", userId)
        .in("lesson_id", lessonIds)
        .order("position", { ascending: true })
    : { data: [] as { lesson_id: string; url: string; title: string; site_name: string; position: number }[] };
  const lesson = (lessons ?? []).find((l) => (sourceRows ?? []).some((s) => s.lesson_id === l.id)) ?? null;
  const sources = lesson ? (sourceRows ?? []).filter((s) => s.lesson_id === lesson.id) : [];

  const active = (siblings ?? []).filter((s) => s.removed_at === null);
  const at = active.findIndex((s) => s.id === stepId);
  return {
    topic: { id: topic.id, title: topic.title },
    step: stepSummary(step, lesson !== null),
    index: at === -1 ? 0 : at + 1,
    total: active.length,
    nextStepId: at === -1 ? null : active[at + 1]?.id ?? null,
    lesson: lesson
      ? {
          id: lesson.id,
          title: lesson.title,
          summary: lesson.summary,
          body: lesson.body,
          model: lesson.model,
          reason: lesson.reason,
          created_at: lesson.created_at,
          minutes: minutesToRead(lesson.body),
        }
      : null,
    sources: sources.map((s) => ({ url: s.url, title: s.title, site_name: s.site_name })),
  };
}

export type PlanOutcome =
  | { kind: "planned" }
  | { kind: "waiting"; retryAfterSeconds: number; message: string }
  | { kind: "failed"; message: string };

/**
 * Plan a topic whose row already exists (status planning or failed). The
 * topic row is written BEFORE this runs, so the text Udit typed is saved even
 * when the AI is busy or the plan comes back unusable.
 */
export async function runPlan(supabase: Client, userId: string, topic: LearningTopic): Promise<PlanOutcome> {
  const rate = checkAiRateLimit(userId);
  if (!rate.allowed) {
    return { kind: "waiting", retryAfterSeconds: rate.retryAfterSeconds, message: "Too many AI requests in a short time." };
  }
  const budget = await budgetState(supabase, userId);
  if (budget.retryAfterSeconds > 0) {
    return {
      kind: "waiting",
      retryAfterSeconds: budget.retryAfterSeconds,
      message: "Today's learning budget is used up.",
    };
  }

  const setTopic = async (patch: Database["public"]["Tables"]["learning_topics"]["Update"]) => {
    const { error } = await supabase.from("learning_topics").update(patch).eq("id", topic.id).eq("user_id", userId);
    if (error) console.error("[learning] topic update failed:", error.message);
  };

  let plan;
  try {
    plan = await planTopic(topic.title);
  } catch (err) {
    if (err instanceof LearningAiError) {
      await logCall(supabase, userId, { topicId: topic.id, stepId: null }, err.record);
      if (err.failure.kind === "minute") {
        await setTopic({ status: "planning", error_message: null });
        return { kind: "waiting", retryAfterSeconds: err.failure.retryAfterSeconds, message: "The AI is busy right now." };
      }
      if (err.failure.kind === "day") {
        await setTopic({ status: "failed", error_message: "The AI's daily limit is reached. Try again tomorrow." });
        return { kind: "failed", message: "The AI's daily limit is reached. Try again tomorrow." };
      }
    }
    await setTopic({ status: "failed", error_message: "The AI could not plan this topic. Try again." });
    return { kind: "failed", message: "The AI could not plan this topic. Try again." };
  }
  await logCall(supabase, userId, { topicId: topic.id, stepId: null }, plan.record);
  if (!plan.steps) {
    const message = `${plan.problem ?? "The plan could not be read."} Try again.`;
    await setTopic({ status: "failed", error_message: message });
    return { kind: "failed", message };
  }

  // A retry after a partial earlier attempt must not collide on position.
  const { count } = await supabase
    .from("learning_steps")
    .select("id", { count: "exact", head: true })
    .eq("topic_id", topic.id)
    .eq("user_id", userId);
  if ((count ?? 0) === 0) {
    const { error } = await supabase.from("learning_steps").insert(
      plan.steps.map((s, i) => ({
        user_id: userId,
        topic_id: topic.id,
        position: i,
        title: s.title.slice(0, 200),
        goal: s.goal.slice(0, 500),
        search_query: s.search_query.slice(0, 300),
      }))
    );
    if (error) {
      console.error("[learning] steps insert failed:", error.message);
      await setTopic({ status: "failed", error_message: "The plan could not be saved. Try again." });
      return { kind: "failed", message: "The plan could not be saved. Try again." };
    }
  }
  await setTopic({ status: "active", error_message: null });
  return { kind: "planned" };
}
