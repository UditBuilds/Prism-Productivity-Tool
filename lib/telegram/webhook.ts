import { chatIdOf, isAuthorizedUpdate } from "@/lib/telegram/auth";
import type { BotDeps } from "@/lib/telegram/deps";
import { SOMETHING_WRONG } from "@/lib/telegram/messages";
import { routeUpdate } from "@/lib/telegram/router";

/**
 * One webhook delivery, start to finish. The route always answers an empty
 * 200 whatever happens here — Telegram retries anything else, and a retry of
 * a half-handled update is exactly what the idempotency elsewhere exists to
 * absorb, not something to provoke.
 *
 * Unparseable or unauthorised: return before ANY other dependency is used —
 * no database read, no AI call, no message.
 *
 * After the gates, a failure is reported to the chat in one honest sentence
 * (button taps report through their own toast instead).
 */
export async function handleWebhook(
  input: { secretHeader: string | null; rawBody: string },
  deps: BotDeps
): Promise<void> {
  let update: unknown;
  try {
    update = JSON.parse(input.rawBody);
  } catch {
    return;
  }
  if (!isAuthorizedUpdate(input.secretHeader, update, deps.env)) return;

  try {
    await routeUpdate(update, deps);
  } catch (err) {
    console.error(
      `[telegram] update ${update.update_id} failed: ${err instanceof Error ? err.message : String(err)}`
    );
    const chatId = chatIdOf(update);
    if (chatId === null || update.callback_query) return;
    try {
      await deps.telegram.sendMessage(chatId, SOMETHING_WRONG);
    } catch (sendErr) {
      console.error(
        `[telegram] could not report the failure to the chat: ${
          sendErr instanceof Error ? sendErr.message : String(sendErr)
        }`
      );
    }
  }
}
