import { json } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { istCivilDateToNoonIso, istCivilDayRange, istDateString } from "@/lib/date";
import { addCivilDays } from "@/lib/daily-plan/compose";
import { ensureDailyPlan } from "@/lib/daily-plan/server";
import type {
  DailyPlanEditResponse,
  DailyPlanEditResult,
  DailyPlanView,
} from "@/lib/daily-plan/view";

/** Creating today's plan can include one Groq call (8s timeout, ~0.8s measured). */
export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A plan holds at most 200 tasks (lib/daily-plan/server.ts), plus anchors. */
const MAX_MOVE_ALL = 250;

/**
 * POST /api/daily-plan — today's plan for the signed-in user, created on first
 * call if the 11:00 cron has not made it yet ("the plan must exist even if the
 * cron fails").
 *
 * POST, NOT GET, ON PURPOSE. The production service worker caches every
 * same-origin GET under /api/ for 24h (next-pwa's default rule, NetworkFirst
 * with a 10s timeout). A GET here could hand back YESTERDAY's plan when the
 * push is tapped on weak signal. POST is never cached, and offline the hook
 * falls back to its own IndexedDB snapshot, which is keyed by IST date.
 */
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  try {
    const { view } = await ensureDailyPlan(supabase, user.id, istDateString());
    return json<DailyPlanView>({ data: view, error: null });
  } catch (err) {
    console.error("[daily-plan] ensure failed", err);
    return json({ data: null, error: "Couldn't load today's plan" }, 500);
  }
}

/**
 * PATCH /api/daily-plan — one edit, one request:
 *   { action: "accept", plan_id }  → accepted_at = now (first accept wins)
 *   { action: "move",   item_id }  → item moved to the plan's NEXT day; a task
 *                                    item also gets its due_date moved there
 *   { action: "move_all", item_ids } → "move" for every listed item still
 *                                    'planned' ("Move all leftovers")
 *   { action: "drop",   item_id }  → item off today's plan: 'dropped' for a
 *                                    task, 'skipped' for an anchor. A LEFTOVER
 *                                    task (due on an earlier day than the
 *                                    plan's) also has its due_date cleared;
 *                                    any other task is not touched. No task
 *                                    is ever deleted.
 *
 * Every edit is IDEMPOTENT, because the offline queue replays it: an item that
 * is no longer 'planned' answers with its current state instead of an error,
 * and "tomorrow" is the plan's own date + 1, never the server clock — an edit
 * queued at 23:50 and replayed after midnight still lands on the right day.
 */
export async function PATCH(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  // Shape: DailyPlanEdit — checked field by field below, never trusted whole.
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ data: null, error: "Invalid JSON body" }, 400);
  }

  const now = new Date().toISOString();

  if (body.action === "accept") {
    const planId = typeof body.plan_id === "string" ? body.plan_id : "";
    if (!UUID_RE.test(planId)) return json({ data: null, error: "Invalid plan_id" }, 400);

    const { error: updateError } = await supabase
      .from("daily_plans")
      .update({ accepted_at: now })
      .eq("id", planId)
      .eq("user_id", user.id)
      .is("accepted_at", null);
    if (updateError) return json({ data: null, error: updateError.message }, 500);

    const { data: plan, error } = await supabase
      .from("daily_plans")
      .select("id, accepted_at")
      .eq("id", planId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return json({ data: null, error: error.message }, 500);
    if (!plan) return json({ data: null, error: "Plan not found" }, 404);
    return json<DailyPlanEditResult>({ data: plan, error: null });
  }

  if (body.action === "move_all") {
    const itemIds = Array.isArray(body.item_ids)
      ? Array.from(new Set<unknown>(body.item_ids))
      : [];
    if (
      itemIds.length === 0 ||
      itemIds.length > MAX_MOVE_ALL ||
      !itemIds.every((id): id is string => typeof id === "string" && UUID_RE.test(id))
    ) {
      return json({ data: null, error: "Invalid item_ids" }, 400);
    }
    return moveAll(supabase, user.id, itemIds, now);
  }

  if (body.action !== "move" && body.action !== "drop") {
    return json({ data: null, error: "Unknown action" }, 400);
  }
  const itemId = typeof body.item_id === "string" ? body.item_id : "";
  if (!UUID_RE.test(itemId)) return json({ data: null, error: "Invalid item_id" }, 400);

  const { data: item, error: itemError } = await supabase
    .from("daily_plan_items")
    .select("id, plan_id, kind, task_id, status, moved_to")
    .eq("id", itemId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (itemError) return json({ data: null, error: itemError.message }, 500);
  if (!item) return json({ data: null, error: "Plan item not found" }, 404);

  // Already edited (a double tap, or the offline queue replaying): report the
  // state it is in. Not an error — the user's intent is already recorded.
  if (item.status !== "planned") {
    return json<DailyPlanEditResult>({
      data: { id: item.id, status: item.status, moved_to: item.moved_to },
      error: null,
    });
  }

  if (body.action === "drop") {
    // A leftover loses its date as well, or tomorrow's plan picks it straight
    // back up as overdue. The leftover rule is in the WHERE clause rather than
    // a read-then-write, so a replay finds the date already null and matches
    // nothing, and a task finished or re-dated elsewhere since the tap is left
    // alone. Task first, item second, for the same reason as move below.
    if (item.kind === "task" && item.task_id) {
      const { data: plan, error: planError } = await supabase
        .from("daily_plans")
        .select("plan_date")
        .eq("id", item.plan_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (planError) return json({ data: null, error: planError.message }, 500);
      if (!plan) return json({ data: null, error: "Plan not found" }, 404);
      const planDay = istCivilDayRange(plan.plan_date);
      if (!planDay) return json({ data: null, error: "Bad plan date" }, 500);

      const { error } = await supabase
        .from("tasks")
        .update({ due_date: null })
        .eq("id", item.task_id)
        .eq("user_id", user.id)
        .neq("status", "done")
        .lt("due_date", planDay.start);
      if (error) return json({ data: null, error: error.message }, 500);
    }

    const status = item.kind === "anchor" ? "skipped" : "dropped";
    const { error } = await supabase
      .from("daily_plan_items")
      .update({ status, status_changed_at: now })
      .eq("id", item.id)
      .eq("user_id", user.id)
      .eq("status", "planned");
    if (error) return json({ data: null, error: error.message }, 500);
    return json<DailyPlanEditResult>({
      data: { id: item.id, status, moved_to: null },
      error: null,
    });
  }

  // move
  const { data: plan, error: planError } = await supabase
    .from("daily_plans")
    .select("plan_date")
    .eq("id", item.plan_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (planError) return json({ data: null, error: planError.message }, 500);
  if (!plan) return json({ data: null, error: "Plan not found" }, 404);

  const tomorrow = addCivilDays(plan.plan_date, 1);

  // The task first, the item second: if the second write fails the item is
  // still 'planned', so the retry runs both again — and the task write is the
  // same value both times. The reverse order could leave an item reading
  // "moved" over a task that never moved.
  if (item.kind === "task" && item.task_id) {
    const { error } = await supabase
      .from("tasks")
      .update({ due_date: istCivilDateToNoonIso(tomorrow) })
      .eq("id", item.task_id)
      .eq("user_id", user.id);
    if (error) return json({ data: null, error: error.message }, 500);
  }

  const { error: moveError } = await supabase
    .from("daily_plan_items")
    .update({ status: "moved", moved_to: tomorrow, status_changed_at: now })
    .eq("id", item.id)
    .eq("user_id", user.id)
    .eq("status", "planned");
  if (moveError) return json({ data: null, error: moveError.message }, 500);

  return json<DailyPlanEditResult>({
    data: { id: item.id, status: "moved", moved_to: tomorrow },
    error: null,
  });
}

/**
 * "Move" for many items at once: per plan, one bulk task write then one bulk
 * item write — the same order as a single move, so a failure between the two
 * leaves the items 'planned' and the retry rewrites the same due dates.
 * Items already off the plan (a replay, a double tap) are reported as they are.
 */
async function moveAll(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  itemIds: string[],
  now: string
) {
  const { data: items, error: itemsError } = await supabase
    .from("daily_plan_items")
    .select("id, plan_id, kind, task_id, status, moved_to")
    .in("id", itemIds)
    .eq("user_id", userId);
  if (itemsError) return json({ data: null, error: itemsError.message }, 500);

  const results = new Map<string, DailyPlanEditResult>(
    (items ?? []).map((i) => [i.id, { id: i.id, status: i.status, moved_to: i.moved_to }])
  );
  const planned = (items ?? []).filter((i) => i.status === "planned");
  const planIds = Array.from(new Set(planned.map((i) => i.plan_id)));

  if (planIds.length > 0) {
    const { data: plans, error: plansError } = await supabase
      .from("daily_plans")
      .select("id, plan_date")
      .in("id", planIds)
      .eq("user_id", userId);
    if (plansError) return json({ data: null, error: plansError.message }, 500);

    for (const plan of plans ?? []) {
      const tomorrow = addCivilDays(plan.plan_date, 1);
      const group = planned.filter((i) => i.plan_id === plan.id);
      // A NULL task_id is a deleted task: nothing to re-date, the item still moves.
      const taskIds = group.flatMap((i) =>
        i.kind === "task" && i.task_id ? [i.task_id] : []
      );

      if (taskIds.length > 0) {
        const { error } = await supabase
          .from("tasks")
          .update({ due_date: istCivilDateToNoonIso(tomorrow) })
          .in("id", taskIds)
          .eq("user_id", userId);
        if (error) return json({ data: null, error: error.message }, 500);
      }

      const { error: moveError } = await supabase
        .from("daily_plan_items")
        .update({ status: "moved", moved_to: tomorrow, status_changed_at: now })
        .in(
          "id",
          group.map((i) => i.id)
        )
        .eq("user_id", userId)
        .eq("status", "planned");
      if (moveError) return json({ data: null, error: moveError.message }, 500);

      for (const i of group) {
        results.set(i.id, { id: i.id, status: "moved", moved_to: tomorrow });
      }
    }
  }

  return json<DailyPlanEditResponse>({
    data: { items: Array.from(results.values()) },
    error: null,
  });
}
