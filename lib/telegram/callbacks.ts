import { parseCallbackData } from "@/lib/telegram/callback-data";
import { captureCallback } from "@/lib/telegram/capture-handlers";
import { isExpiredCallbackQuery } from "@/lib/telegram/client";
import type { BotDeps } from "@/lib/telegram/deps";
import { BUTTON_EXPIRED, COULDNT_SAVE } from "@/lib/telegram/messages";
import { planCallback } from "@/lib/telegram/plan-handlers";
import { tellChat } from "@/lib/telegram/tell-chat";
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

export interface CallbackHandler {
  /**
   * Action letter → the toast shown the moment the button is tapped. It is
   * sent before any database work, so it cannot depend on the outcome; null
   * stops the spinner with no text. A letter not listed is an expired button.
   */
  acks: Readonly<Record<string, string | null>>;
  /**
   * Does the work. Any outcome the toast did not cover is said in the chat. A
   * throw means nothing was confirmed, and is reported as COULDNT_SAVE.
   */
  run(ctx: CallbackContext, deps: BotDeps): Promise<void>;
}

export const CALLBACK_HANDLERS: Readonly<Record<string, CallbackHandler>> = {
  p: planCallback,
  c: captureCallback,
};

/**
 * Route one tap: ANSWER FIRST, before any database work, then do the work.
 *
 * The button spins until Telegram gets this answer, so it must not wait for
 * the writes and the redraw. The work is still awaited inside the request, so
 * the instance cannot freeze with it unfinished, and Telegram can redeliver if
 * the function dies. A failure after the answer is told to the chat, because
 * the toast is already gone.
 */
export async function routeCallback(query: TgCallbackQuery, deps: BotDeps): Promise<void> {
  const parsed = parseCallbackData(query.data);
  const handler = parsed ? CALLBACK_HANDLERS[parsed.namespace] : undefined;
  const ack = parsed && handler ? handler.acks[parsed.action] : undefined;

  if (!parsed || !handler || ack === undefined) {
    await acknowledge(query, BUTTON_EXPIRED, deps);
    return;
  }

  await acknowledge(query, ack ?? undefined, deps);

  try {
    await handler.run({ action: parsed.action, id: parsed.id, query }, deps);
  } catch (err) {
    console.error(
      `[telegram] button "${parsed.namespace}:${parsed.action}" failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    await tellChat(query, COULDNT_SAVE, deps);
  }
}

/**
 * Stop the spinner. A failed answer never stops the tap's work: the redraw is
 * the real confirmation, and a failure after that is told to the chat anyway.
 */
async function acknowledge(
  query: TgCallbackQuery,
  text: string | undefined,
  deps: BotDeps
): Promise<void> {
  try {
    await deps.telegram.answerCallbackQuery(query.id, text);
  } catch (err) {
    if (isExpiredCallbackQuery(err)) return;
    console.error(
      `[telegram] answerCallbackQuery failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
