import type { DailyPlanEditResult } from "@/lib/daily-plan/view";
import type { CallbackContext } from "@/lib/telegram/callbacks";
import type { BotDeps } from "@/lib/telegram/deps";
import { BUTTON_EXPIRED } from "@/lib/telegram/messages";
import { renderPlanMessage } from "@/lib/telegram/plan-message";

/**
 * The plan message's buttons — namespace "p".
 *
 * Each tap runs deps.plan.applyEdit, which is applyDailyPlanEdit from
 * lib/daily-plan/edit.ts: the SAME function PATCH /api/daily-plan runs for the
 * dashboard card, with the same validation, the same writes in the same
 * order, and the same idempotency. Only the caller differs (service role
 * scoped to the owner, instead of the owner's own session).
 *
 * After the edit, the message is redrawn from the database, so it shows what
 * actually happened — including edits made in the app meanwhile.
 */

const BODIES: Record<string, (id: string) => Record<string, unknown>> = {
  a: (id) => ({ action: "accept", plan_id: id }),
  m: (id) => ({ action: "move", item_id: id }),
  d: (id) => ({ action: "drop", item_id: id }),
};

export async function handlePlanCallback(
  { action, id, query }: CallbackContext,
  deps: BotDeps
): Promise<string> {
  const body = BODIES[action];
  if (!body) return BUTTON_EXPIRED;
  const owner = deps.env.ownerUserId;

  const outcome = await deps.plan.applyEdit(
    deps.db,
    owner,
    body(id),
    new Date(deps.now()).toISOString()
  );
  if (outcome.status !== 200 || !outcome.body.data) {
    if (outcome.status === 404) {
      return action === "a" ? "That plan isn't there any more." : "That item isn't on a plan any more.";
    }
    console.error(
      `[telegram] plan edit "${action}" failed (${outcome.status}): ${outcome.body.error ?? "no error text"}`
    );
    return "Couldn't update the plan just now. Try again in a minute.";
  }

  const planId = action === "a" ? id : await planIdForItem(deps, owner, id);
  if (planId && query.message) {
    try {
      const view = await deps.plan.readView(deps.db, owner, planId);
      if (view?.plan) {
        const { text, keyboard } = renderPlanMessage(view);
        await deps.telegram.editMessageText(query.message.chat.id, query.message.message_id, text, keyboard);
      }
    } catch (err) {
      // The edit itself is saved; only the redraw failed. Say so in the log,
      // and let the toast still confirm the change.
      console.error(
        `[telegram] plan message redraw failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (action === "a") return "Plan accepted";
  const result = outcome.body.data as DailyPlanEditResult;
  if (result.status === "moved") return "Moved to tomorrow";
  if (result.status === "dropped" || result.status === "skipped") return "Dropped from today";
  return "Done";
}

async function planIdForItem(deps: BotDeps, owner: string, itemId: string): Promise<string | null> {
  const { data, error } = await deps.db
    .from("daily_plan_items")
    .select("plan_id")
    .eq("id", itemId)
    .eq("user_id", owner)
    .maybeSingle();
  if (error) {
    console.error(`[telegram] plan item lookup failed: ${error.message}`);
    return null;
  }
  return data?.plan_id ?? null;
}
