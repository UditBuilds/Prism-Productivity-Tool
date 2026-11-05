import { parseCallbackData } from "@/lib/telegram/callback-data";
import { handleCaptureCallback } from "@/lib/telegram/capture-handlers";
import type { BotDeps } from "@/lib/telegram/deps";
import { BUTTON_EXPIRED, TAP_AGAIN } from "@/lib/telegram/messages";
import { handlePlanCallback } from "@/lib/telegram/plan-handlers";
import type { TgCallbackQuery } from "@/lib/telegram/types";

/**
 * The callback-action router: a button's namespace letter picks its handler.
 * A later phase adds a feature by adding one entry here and one letter in
 * lib/telegram/callback-data.ts — nothing else changes.
 */

export interface CallbackContext {
  action: string;
  id: string;
  query: TgCallbackQuery;
}

/** Does the work for one tap and returns the short toast text to show. */
export type CallbackHandler = (ctx: CallbackContext, deps: BotDeps) => Promise<string>;

export const CALLBACK_HANDLERS: Readonly<Record<string, CallbackHandler>> = {
  p: handlePlanCallback,
  c: handleCaptureCallback,
};

/**
 * Route one tap, then ALWAYS answer it — an unanswered tap leaves a spinner
 * on the button. A failing handler is answered with an honest toast instead
 * of an error status, which Telegram would only retry.
 */
export async function routeCallback(query: TgCallbackQuery, deps: BotDeps): Promise<void> {
  const parsed = parseCallbackData(query.data);
  const handler = parsed ? CALLBACK_HANDLERS[parsed.namespace] : undefined;

  let toast = BUTTON_EXPIRED;
  if (parsed && handler) {
    try {
      toast = await handler({ action: parsed.action, id: parsed.id, query }, deps);
    } catch (err) {
      console.error(
        `[telegram] button "${parsed.namespace}:${parsed.action}" failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      toast = TAP_AGAIN;
    }
  }

  try {
    await deps.telegram.answerCallbackQuery(query.id, toast);
  } catch (err) {
    console.error(
      `[telegram] answerCallbackQuery failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
