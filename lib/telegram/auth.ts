import { timingSafeEqual } from "node:crypto";

import type { TgUpdate } from "@/lib/telegram/types";

/**
 * The two gates every update must pass before the bot does ANYTHING — reads
 * the database, calls the AI, or answers. Fail either and the webhook returns
 * an empty 200 and stops (app/api/telegram/webhook/route.ts):
 *
 *   1. The X-Telegram-Bot-Api-Secret-Token header equals
 *      TELEGRAM_WEBHOOK_SECRET. Telegram sends it on every delivery once the
 *      webhook was registered with `secret_token`; nobody else knows it.
 *   2. The update comes from TELEGRAM_ALLOWED_CHAT_ID. A leaked secret alone
 *      still cannot make the bot act for a stranger's chat.
 *
 * Pure apart from the constant-time compare, so it is unit-tested directly.
 */

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual needs equal lengths; a length mismatch is a mismatch.
  if (a.length !== b.length || b.length === 0) return false;
  return timingSafeEqual(a, b);
}

/**
 * The chat an update belongs to, or null for any kind of update this bot
 * does not handle (edits, channel posts, inline queries, callback buttons on
 * a message it did not send).
 */
export function chatIdOf(update: unknown): number | null {
  if (typeof update !== "object" || update === null) return null;
  const u = update as TgUpdate;
  const id = u.message?.chat?.id ?? u.callback_query?.message?.chat?.id;
  return typeof id === "number" && Number.isSafeInteger(id) ? id : null;
}

export function isAuthorizedUpdate(
  secretHeader: string | null,
  update: unknown,
  env: { webhookSecret: string; allowedChatId: string }
): update is TgUpdate {
  if (secretHeader === null || !sameSecret(secretHeader, env.webhookSecret)) {
    return false;
  }
  const chatId = chatIdOf(update);
  return chatId !== null && String(chatId) === env.allowedChatId;
}
