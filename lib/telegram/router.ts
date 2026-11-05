import { routeCallback } from "@/lib/telegram/callbacks";
import { handleCaptureMessage } from "@/lib/telegram/capture-handlers";
import type { BotDeps } from "@/lib/telegram/deps";
import { HELP_TEXT, TEXT_ONLY } from "@/lib/telegram/messages";
import type { TgUpdate } from "@/lib/telegram/types";

/**
 * The update router: what kind of update this is decides who handles it.
 * Called ONLY after both auth gates passed (lib/telegram/auth.ts).
 *
 *   button tap       → the callback router (lib/telegram/callbacks.ts)
 *   "/start", "/help", any other "/command" → the help text
 *   any other text   → quick capture
 *   anything else    → "I can read text for now" (photos, voice, stickers)
 */
export async function routeUpdate(update: TgUpdate, deps: BotDeps): Promise<void> {
  if (update.callback_query) {
    await routeCallback(update.callback_query, deps);
    return;
  }

  const msg = update.message;
  if (!msg) return;

  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  if (!text) {
    await deps.telegram.sendMessage(msg.chat.id, TEXT_ONLY);
    return;
  }

  if (text.startsWith("/")) {
    await deps.telegram.sendMessage(msg.chat.id, HELP_TEXT);
    return;
  }

  await handleCaptureMessage(msg, text, deps);
}
