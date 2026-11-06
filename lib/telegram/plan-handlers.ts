import type { CallbackContext, CallbackHandler } from "@/lib/telegram/callbacks";
import type { BotDeps } from "@/lib/telegram/deps";
import { COULDNT_SAVE, ITEM_GONE, PLAN_GONE, REDRAW_FAILED } from "@/lib/telegram/messages";
import { renderPlanMessage } from "@/lib/telegram/plan-message";
import { tellChat } from "@/lib/telegram/tell-chat";

/**
 * The plan message's buttons — namespace "p".
 *
 * Each tap runs deps.plan.applyEdit, which is applyDailyPlanEdit from
 * lib/daily-plan/edit.ts: the SAME function PATCH /api/daily-plan runs for the
 * dashboard card, with the same validation, the same writes in the same
 * order, and the same idempotency. Only the caller differs (service role
 * scoped to the owner, instead of the owner's own session).
 *
 * After the edit, the message is redrawn from a fresh database read, so it
 * shows what actually happened — including edits made in the app meanwhile, and
 * a tap whose toast was optimistic (Drop on a row that had already moved).
 */

const BODIES: Record<string, (id: string) => Record<string, unknown>> = {
  a: (id) => ({ action: "accept", plan_id: id }),
  m: (id) => ({ action: "move", item_id: id }),
  d: (id) => ({ action: "drop", item_id: id }),
};

async function run({ action, id, query }: CallbackContext, deps: BotDeps): Promise<void> {
  const owner = deps.env.ownerUserId;

  const outcome = await deps.plan.applyEdit(
    deps.db,
    owner,
    BODIES[action](id),
    new Date(deps.now()).toISOString()
  );
  if (outcome.status !== 200 || !outcome.body.data) {
    if (outcome.status === 404) {
      await tellChat(query, action === "a" ? PLAN_GONE : ITEM_GONE, deps);
      return;
    }
    console.error(
      `[telegram] plan edit "${action}" failed (${outcome.status}): ${outcome.body.error ?? "no error text"}`
    );
    await tellChat(query, COULDNT_SAVE, deps);
    return;
  }

  if (!query.message) return;
  try {
    const view = outcome.planId ? await deps.plan.readView(deps.db, owner, outcome.planId) : null;
    if (!view?.plan) throw new Error("the plan could not be read back");
    const { text, keyboard } = renderPlanMessage(view);
    // A redraw that changes nothing is not an error (lib/telegram/client.ts).
    await deps.telegram.editMessageText(query.message.chat.id, query.message.message_id, text, keyboard);
  } catch (err) {
    console.error(
      `[telegram] plan message redraw failed: ${err instanceof Error ? err.message : String(err)}`
    );
    await tellChat(query, REDRAW_FAILED, deps);
  }
}

export const planCallback: CallbackHandler = {
  acks: { a: "Plan accepted", m: "Moved to tomorrow", d: "Dropped" },
  run,
};
