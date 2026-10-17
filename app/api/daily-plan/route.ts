import { json } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { istCivilDateToNoonIso, istDateString } from "@/lib/date";
import { addCivilDays } from "@/lib/daily-plan/compose";
import { ensureDailyPlan } from "@/lib/daily-plan/server";
import type { DailyPlanEditResult, DailyPlanView } from "@/lib/daily-plan/view";

/** Creating today's plan can include one Groq call (8s timeout, ~0.8s measured). */
export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 *   { action: "drop",   item_id }  → item off today's plan: 'dropped' for a
 *                                    task, 'skipped' for an anchor. The task
 *                                    itself is never touched.
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
