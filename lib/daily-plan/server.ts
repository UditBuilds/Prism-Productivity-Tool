import type { SupabaseClient } from "@supabase/supabase-js";

import { orderDailyPlan } from "@/lib/ai/client";
import { checkAiRateLimit } from "@/lib/ai/rateLimit";
import { istCivilDayRange } from "@/lib/date";
import {
  MAX_AI_ITEMS,
  aiPlanInput,
  buildPlanCandidates,
  civilWeekday,
  civilWeekdayName,
  cleanAiReason,
  fallbackOrder,
  fallbackReason,
  toPlanItemsPayload,
  validateAiOrder,
  type PlanCandidate,
  type PlanPriority,
} from "@/lib/daily-plan/compose";
import type { DailyPlanView, DailyPlanViewItem } from "@/lib/daily-plan/view";
import type { DailyPlan, Database } from "@/types/database";

type Db = SupabaseClient<Database>;

/**
 * Why a plan was not ordered by the AI. Logged, never shown: the user sees a
 * plan either way, and the plan row's `source` says which kind it is.
 */
type FallbackCause =
  | "no_items"
  | "too_many"
  | "rate_limited"
  | "ai_error"
  | "invalid_order"
  | "invalid_reason";

export interface EnsureResult {
  view: DailyPlanView;
  /** The full plan row, for the cron's push bookkeeping. null = planner off. */
  plan: DailyPlan | null;
  /** True when THIS call created the plan (false: it already existed). */
  created: boolean;
}

const EMPTY_VIEW: DailyPlanView = { plan: null, items: [] };

/**
 * Today's plan for one user: read it, or create it exactly once.
 *
 * Called from two places with two clients — the dashboard (the user's own
 * session, RLS applies) and the 11:00 cron (service role, RLS bypassed) — so
 * EVERY query below filters on user_id explicitly. Under the service role that
 * filter is the only thing keeping one user's plan from reading another's
 * tasks.
 *
 * Idempotent: create_daily_plan inserts the plan and its items in one
 * transaction with ON CONFLICT DO NOTHING, so a dashboard open racing the cron
 * gets the winner's plan back, and a plan row never exists without its items.
 *
 * The planner is OPT-IN by data: a user with no active anchors gets
 * `plan: null`, no AI call and no write. That keeps every other account on
 * this shared project exactly as it was.
 */
export async function ensureDailyPlan(
  supabase: Db,
  userId: string,
  planDate: string
): Promise<EnsureResult> {
  const existing = await readPlanRow(supabase, userId, planDate);
  if (existing) {
    return { view: await buildView(supabase, userId, existing), plan: existing, created: false };
  }

  const { data: anchors, error: anchorsError } = await supabase
    .from("plan_anchors")
    .select("id, title, days_of_week, position, follows_anchor_id")
    .eq("user_id", userId)
    .eq("is_active", true);
  if (anchorsError) throw new Error(`plan anchors: ${anchorsError.message}`);
  if (!anchors || anchors.length === 0) {
    return { view: EMPTY_VIEW, plan: null, created: false };
  }

  // Anchors moved here from yesterday ("move to tomorrow" on an anchor).
  const { data: carriedRows, error: carriedError } = await supabase
    .from("daily_plan_items")
    .select("anchor_id")
    .eq("user_id", userId)
    .eq("kind", "anchor")
    .eq("status", "moved")
    .eq("moved_to", planDate)
    .not("anchor_id", "is", null);
  if (carriedError) throw new Error(`carried anchors: ${carriedError.message}`);

  const range = istCivilDayRange(planDate);
  if (!range) throw new Error(`ensureDailyPlan: bad plan date ${planDate}`);

  // Overdue (unbounded back) + due today. The upper bound is 00:00 IST
  // tomorrow; compose.ts re-checks by IST civil day, so a task due tomorrow
  // cannot slip in even if this bound were wrong.
  const { data: tasks, error: tasksError } = await supabase
    .from("tasks")
    .select("id, title, due_date, priority")
    .eq("user_id", userId)
    .neq("status", "done")
    .not("due_date", "is", null)
    .lt("due_date", range.end)
    .order("due_date", { ascending: true })
    .limit(200);
  if (tasksError) throw new Error(`plan tasks: ${tasksError.message}`);

  const candidates = buildPlanCandidates({
    planDate,
    anchors,
    carriedAnchorIds: (carriedRows ?? [])
      .map((r) => r.anchor_id)
      .filter((id): id is string => id !== null),
    tasks: (tasks ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      due_date: t.due_date as string,
      priority: t.priority as PlanPriority,
    })),
  });

  const ordered = await orderCandidates(candidates, userId, planDate);

  const { error: rpcError } = await supabase.rpc("create_daily_plan", {
    p_user_id: userId,
    p_plan_date: planDate,
    p_source: ordered.source,
    p_reason: ordered.reason,
    p_items: toPlanItemsPayload(ordered.order, candidates),
  });
  if (rpcError) throw new Error(`create_daily_plan: ${rpcError.message}`);

  const plan = await readPlanRow(supabase, userId, planDate);
  if (!plan) throw new Error("create_daily_plan returned but no plan row is readable");
  // `created` is best-effort: a concurrent winner's plan reads the same.
  return { view: await buildView(supabase, userId, plan), plan, created: true };
}

/**
 * The AI's order when it passes every check, the fixed order otherwise. Never
 * throws — the plan must exist whatever Groq does.
 */
async function orderCandidates(
  candidates: PlanCandidate[],
  userId: string,
  planDate: string
): Promise<{ order: string[]; reason: string; source: "ai" | "fallback" }> {
  const fallback = (cause: FallbackCause) => {
    if (cause !== "no_items") {
      console.warn(`[daily-plan] fallback order for ${planDate}: ${cause}`);
    }
    return {
      order: fallbackOrder(candidates),
      reason: fallbackReason(candidates),
      source: "fallback" as const,
    };
  };

  if (candidates.length === 0) return fallback("no_items");
  // One item has one order; asking the model would only spend tokens.
  if (candidates.length === 1) return fallback("no_items");
  if (candidates.length > MAX_AI_ITEMS) return fallback("too_many");
  if (!checkAiRateLimit(userId).allowed) return fallback("rate_limited");

  let answer;
  try {
    answer = await orderDailyPlan(
      aiPlanInput(candidates),
      planDate,
      civilWeekdayName(planDate)
    );
  } catch {
    return fallback("ai_error");
  }

  const order = validateAiOrder(answer.order, candidates);
  if (!order) return fallback("invalid_order");
  const first = candidates.find((c) => c.key === order[0]);
  const reason = first ? cleanAiReason(answer.reason, first.title) : null;
  if (!reason) return fallback("invalid_reason");

  return { order, reason, source: "ai" };
}

async function readPlanRow(
  supabase: Db,
  userId: string,
  planDate: string
): Promise<DailyPlan | null> {
  const { data, error } = await supabase
    .from("daily_plans")
    .select("*")
    .eq("user_id", userId)
    .eq("plan_date", planDate)
    .maybeSingle();
  if (error) throw new Error(`daily plan: ${error.message}`);
  return data;
}

/**
 * The plan as the dashboard shows it: stored items joined to the LIVE task
 * and anchor rows, so a task completed or deleted since the plan was made is
 * shown as such rather than as it was at 11:00.
 */
async function buildView(
  supabase: Db,
  userId: string,
  plan: DailyPlan
): Promise<DailyPlanView> {
  const { data: items, error } = await supabase
    .from("daily_plan_items")
    .select("*")
    .eq("user_id", userId)
    .eq("plan_id", plan.id)
    .order("position", { ascending: true });
  if (error) throw new Error(`plan items: ${error.message}`);

  const taskIds = (items ?? []).flatMap((i) => (i.task_id ? [i.task_id] : []));
  const anchorIds = (items ?? []).flatMap((i) => (i.anchor_id ? [i.anchor_id] : []));

  const [tasksRes, anchorsRes] = await Promise.all([
    taskIds.length
      ? supabase
          .from("tasks")
          .select("id, due_date, status")
          .eq("user_id", userId)
          .in("id", taskIds)
      : Promise.resolve({ data: [], error: null }),
    anchorIds.length
      ? supabase
          .from("plan_anchors")
          .select("id, title, days_of_week, follows_anchor_id")
          .eq("user_id", userId)
          .in("id", anchorIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (tasksRes.error) throw new Error(`plan item tasks: ${tasksRes.error.message}`);
  if (anchorsRes.error) throw new Error(`plan item anchors: ${anchorsRes.error.message}`);

  const taskById = new Map((tasksRes.data ?? []).map((t) => [t.id, t]));
  const anchorById = new Map((anchorsRes.data ?? []).map((a) => [a.id, a]));
  const weekday = civilWeekday(plan.plan_date);

  const viewItems: DailyPlanViewItem[] = (items ?? []).map((item) => {
    const task = item.task_id ? taskById.get(item.task_id) : undefined;
    const anchor = item.anchor_id ? anchorById.get(item.anchor_id) : undefined;
    const leader =
      anchor?.follows_anchor_id && anchorIds.includes(anchor.follows_anchor_id)
        ? anchorById.get(anchor.follows_anchor_id)
        : undefined;
    return {
      id: item.id,
      position: item.position,
      kind: item.kind,
      title: item.title,
      status: item.status,
      moved_to: item.moved_to,
      task_id: task ? task.id : null,
      task_due_date: task?.due_date ?? null,
      task_done: task?.status === "done",
      after_title: leader?.title ?? null,
      carried: anchor ? !anchor.days_of_week.includes(weekday) : false,
      gone: item.kind === "task" ? !task : !anchor,
    };
  });

  return {
    plan: {
      id: plan.id,
      plan_date: plan.plan_date,
      source: plan.source,
      reason: plan.reason,
      accepted_at: plan.accepted_at,
    },
    items: viewItems,
  };
}
