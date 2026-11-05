/**
 * The bot's configuration, read from the environment.
 *
 * NEVER LOG A VALUE FROM HERE. The token, the webhook secret, the chat id and
 * the owner's user id are all secrets or personal identifiers. Logging the
 * NAME of a missing variable is fine and is what readTelegramEnv's caller does.
 */

export interface TelegramEnv {
  botToken: string;
  /** The ONE chat the bot answers. A string: compared to String(chat.id). */
  allowedChatId: string;
  webhookSecret: string;
  /** Every write the bot makes is as this user, scoped by this id. */
  ownerUserId: string;
}

export const TELEGRAM_ENV_NAMES = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_ALLOWED_CHAT_ID",
  "TELEGRAM_WEBHOOK_SECRET",
  "PRISM_OWNER_USER_ID",
] as const;

/**
 * All four variables, trimmed, or null when any is missing or blank. A
 * half-configured bot does nothing at all rather than half of something.
 */
export function readTelegramEnv(
  source: Record<string, string | undefined> = process.env
): TelegramEnv | null {
  const get = (name: (typeof TELEGRAM_ENV_NAMES)[number]) =>
    (source[name] ?? "").trim();
  const env: TelegramEnv = {
    botToken: get("TELEGRAM_BOT_TOKEN"),
    allowedChatId: get("TELEGRAM_ALLOWED_CHAT_ID"),
    webhookSecret: get("TELEGRAM_WEBHOOK_SECRET"),
    ownerUserId: get("PRISM_OWNER_USER_ID"),
  };
  if (!env.botToken || !env.allowedChatId || !env.webhookSecret || !env.ownerUserId) {
    return null;
  }
  return env;
}

/** Names of the variables that are missing or blank. Names only, never values. */
export function missingTelegramEnv(
  source: Record<string, string | undefined> = process.env
): string[] {
  return TELEGRAM_ENV_NAMES.filter((name) => !(source[name] ?? "").trim());
}

/**
 * Where a notification for the OWNER goes. Other users always get web push,
 * whatever this says — the flags exist so the owner can move to Telegram
 * once it is proven, not to change anyone else's app.
 */
export type NotifyChannel = "webpush" | "telegram" | "both";

/**
 * PLAN_NOTIFY_CHANNEL / REMINDER_NOTIFY_CHANNEL. Unset means "both". An
 * unrecognised value also means "both" and is reported as invalid, so a typo
 * can never switch every channel off.
 */
export function readNotifyChannel(raw: string | undefined): {
  channel: NotifyChannel;
  valid: boolean;
} {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return { channel: "both", valid: true };
  if (value === "webpush" || value === "telegram" || value === "both") {
    return { channel: value, valid: true };
  }
  return { channel: "both", valid: false };
}

export function wantsTelegram(channel: NotifyChannel): boolean {
  return channel === "telegram" || channel === "both";
}
