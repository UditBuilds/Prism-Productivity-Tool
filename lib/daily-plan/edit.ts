import type { SupabaseClient } from "@supabase/supabase-js";

import type { ApiResponse } from "@/lib/api/envelope";
import { istCivilDateToNoonIso, istCivilDayRange } from "@/lib/date";
import { addCivilDays } from "@/lib/daily-plan/compose";
import type {
  DailyPlanEditResponse,
  DailyPlanEditResult,
} from "@/lib/daily-plan/view";
import type { Database } from "@/types/database";

type Db = SupabaseClient<Database>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A plan holds at most 200 tasks (lib/daily-plan/server.ts), plus anchors. */
const MAX_MOVE_ALL = 250;

/**
 * What one plan edit answers: the HTTP status and the `{ data, error }`
 * envelope. PATCH /api/daily-plan sends it as-is; the Telegram bot reads it.
 */
export interface PlanEditOutcome {
  status: number;
  body: ApiResponse<DailyPlanEditResponse>;
  /**
   * The plan a single edit belongs to, so the bot can redraw it without reading
   * the item again. Outside `body`: the app's response is unchanged.
   */
  planId?: string;
}

function ok(data: DailyPlanEditResponse, planId?: string): PlanEditOutcome {
  return { status: 200, body: { data, error: null }, planId };
}

function fail(status: number, error: string): PlanEditOutcome {
  return { status, body: { data: null, error } };
}

/**
 * ONE plan edit — accept, move, move_all or drop — for one user. The single
 * code path behind both the dashboard's plan card (PATCH /api/daily-plan, the
 * user's own session) and the Telegram bot's buttons (service role), so the
 * two can never disagree about what a tap does.
 *
 * Moved here verbatim from the PATCH handler. EVERY query filters on
 * `userId` explicitly: under the service role that filter is the only thing
 * keeping one user's tap from editing another's plan.
 *
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
 * Every edit is IDEMPOTENT, because the offline queue replays it and Telegram
 * redelivers: an item that is no longer 'planned' answers with its current
 * state instead of an error, and "tomorrow" is the plan's own date + 1, never
 * the server clock — an edit queued at 23:50 and replayed after midnight
 * still lands on the right day.
 *
 * `body` is the request body as parsed JSON — checked field by field here,
 * never trusted whole. `now` is the ISO instant stamped on the edit.
 */
export async function applyDailyPlanEdit(
  supabase: Db,
  userId: string,
  body: Record<string, unknown>,
  now: string
): Promise<PlanEditOutcome> {
  if (body.action === "accept") {
    const planId = typeof body.plan_id === "string" ? body.plan_id : "";
    if (!UUID_RE.test(planId)) return fail(400, "Invalid plan_id");

    const { error: updateError } = await supabase
      .from("daily_plans")
      .update({ accepted_at: now })
      .eq("id", planId)
      .eq("user_id", userId)
      .is("accepted_at", null);
    if (updateError) return fail(500, updateError.message);

    const { data: plan, error } = await supabase
      .from("daily_plans")
      .select("id, accepted_at")
      .eq("id", planId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return fail(500, error.message);
    if (!plan) return fail(404, "Plan not found");
    return ok(plan as DailyPlanEditResult, plan.id);
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
      return fail(400, "Invalid item_ids");
    }
    return moveAll(supabase, userId, itemIds, now);
  }

  if (body.action !== "move" && body.action !== "drop") {
    return fail(400, "Unknown action");
  }
  const itemId = typeof body.item_id === "string" ? body.item_id : "";
  if (!UUID_RE.test(itemId)) return fail(400, "Invalid item_id");

  const { data: item, error: itemError } = await supabase
    .from("daily_plan_items")
    .select("id, plan_id, kind, task_id, status, moved_to")
    .eq("id", itemId)
    .eq("user_id", userId)
    .maybeSingle();
  if (itemError) return fail(500, itemError.message);
  if (!item) return fail(404, "Plan item not found");

  // Already edited (a double tap, or the offline queue replaying): report the
  // state it is in. Not an error — the user's intent is already recorded.
  if (item.status !== "planned") {
    return ok({ id: item.id, status: item.status, moved_to: item.moved_to }, item.plan_id);
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
        .eq("user_id", userId)
        .maybeSingle();
      if (planError) return fail(500, planError.message);
      if (!plan) return fail(404, "Plan not found");
      const planDay = istCivilDayRange(plan.plan_date);
      if (!planDay) return fail(500, "Bad plan date");

      const { error } = await supabase
        .from("tasks")
        .update({ due_date: null })
        .eq("id", item.task_id)
        .eq("user_id", userId)
        .neq("status", "done")
        .lt("due_date", planDay.start);
      if (error) return fail(500, error.message);
    }

    const status = item.kind === "anchor" ? "skipped" : "dropped";
    const { error } = await supabase
      .from("daily_plan_items")
      .update({ status, status_changed_at: now })
      .eq("id", item.id)
      .eq("user_id", userId)
      .eq("status", "planned");
    if (error) return fail(500, error.message);
    return ok({ id: item.id, status, moved_to: null }, item.plan_id);
  }

  // move
  const { data: plan, error: planError } = await supabase
    .from("daily_plans")
    .select("plan_date")
    .eq("id", item.plan_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (planError) return fail(500, planError.message);
  if (!plan) return fail(404, "Plan not found");

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
      .eq("user_id", userId);
    if (error) return fail(500, error.message);
  }

  const { error: moveError } = await supabase
    .from("daily_plan_items")
    .update({ status: "moved", moved_to: tomorrow, status_changed_at: now })
    .eq("id", item.id)
    .eq("user_id", userId)
    .eq("status", "planned");
  if (moveError) return fail(500, moveError.message);

  return ok({ id: item.id, status: "moved", moved_to: tomorrow }, item.plan_id);
}

/**
 * "Move" for many items at once: per plan, one bulk task write then one bulk
 * item write — the same order as a single move, so a failure between the two
 * leaves the items 'planned' and the retry rewrites the same due dates.
 * Items already off the plan (a replay, a double tap) are reported as they are.
 */
async function moveAll(
  supabase: Db,
  userId: string,
  itemIds: string[],
  now: string
): Promise<PlanEditOutcome> {
  const { data: items, error: itemsError } = await supabase
    .from("daily_plan_items")
    .select("id, plan_id, kind, task_id, status, moved_to")
    .in("id", itemIds)
    .eq("user_id", userId);
  if (itemsError) return fail(500, itemsError.message);

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
    if (plansError) return fail(500, plansError.message);

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
        if (error) return fail(500, error.message);
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
      if (moveError) return fail(500, moveError.message);

      for (const i of group) {
        results.set(i.id, { id: i.id, status: "moved", moved_to: tomorrow });
      }
    }
  }

  return ok({ items: Array.from(results.values()) });
}
