/**
 * The slice of the Telegram Bot API this bot reads. Deliberately partial:
 * every field is optional where Telegram may leave it out, and nothing here
 * is trusted until lib/telegram/auth.ts has checked the update.
 *
 * https://core.telegram.org/bots/api#update
 */

export interface TgUser {
  id: number;
  first_name?: string;
}

export interface TgChat {
  id: number;
  type?: string;
}

export interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  date?: number;
  text?: string;
}

export interface TgCallbackQuery {
  id: string;
  from?: TgUser;
  /** Absent for buttons on inline-mode messages — never ours, so rejected. */
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

/** One inline button. callback_data is limited to 1–64 BYTES by Telegram. */
export interface InlineButton {
  text: string;
  callback_data: string;
}

export type InlineKeyboard = InlineButton[][];
