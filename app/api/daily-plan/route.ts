import { json } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { istDateString } from "@/lib/date";
import { applyDailyPlanEdit } from "@/lib/daily-plan/edit";
import { ensureDailyPlan } from "@/lib/daily-plan/server";
import type { DailyPlanEditResponse, DailyPlanView } from "@/lib/daily-plan/view";

/** Creating today's plan can include one Groq call (8s timeout, ~0.8s measured). */
export const maxDuration = 30;

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

  // Shape: DailyPlanEdit — checked field by field in applyDailyPlanEdit,
  // never trusted whole.
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ data: null, error: "Invalid JSON body" }, 400);
  }

  const now = new Date().toISOString();

  // The edit itself lives in lib/daily-plan/edit.ts so the Telegram bot's
  // buttons run exactly this code path, under the service role.
  const outcome = await applyDailyPlanEdit(supabase, user.id, body, now);
  return json<DailyPlanEditResponse>(outcome.body, outcome.status);
}
