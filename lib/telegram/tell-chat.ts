import type { BotDeps } from "@/lib/telegram/deps";
import type { TgCallbackQuery } from "@/lib/telegram/types";

/**
 * A short message in the chat a button was tapped in: how a tap reports what
 * its toast could not know, because the toast goes out before the work runs.
 *
 * Never throws. It is the last thing a failing tap does, so if this fails too
 * there is nowhere left to report to but the log.
 */
export async function tellChat(
  query: TgCallbackQuery,
  text: string,
  deps: BotDeps
): Promise<void> {
  if (!query.message) return;
  try {
    await deps.telegram.sendMessage(query.message.chat.id, text);
  } catch (err) {
    console.error(
      `[telegram] could not tell the chat: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
