import type { InlineKeyboard } from "@/lib/telegram/types";

/**
 * A minimal Telegram Bot API client: the three calls this bot makes.
 * SERVER-ONLY — holds the bot token.
 *
 * THE TOKEN IS IN EVERY REQUEST URL (that is how the Bot API works), so no
 * error from here ever carries the URL: a failure is reported as the method
 * name, Telegram's error code and Telegram's own description.
 *
 * Every call is meant to be AWAITED by its caller. A serverless instance can
 * freeze the moment the response is sent, taking an unfinished request with
 * it.
 */

const API_BASE = "https://api.telegram.org";

/** Bound on one Bot API request. Well inside the webhook's maxDuration. */
const REQUEST_TIMEOUT_MS = 8000;

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    /** Telegram's error_code, or the HTTP status when the body was unreadable. */
    readonly code: number | null,
    readonly description: string
  ) {
    super(`Telegram ${method} failed${code ? ` (${code})` : ""}: ${description}`);
    this.name = "TelegramApiError";
  }
}

export interface TelegramApi {
  sendMessage(
    chatId: number | string,
    text: string,
    keyboard?: InlineKeyboard
  ): Promise<{ message_id: number }>;
  /** `keyboard: null` removes the buttons; undefined leaves none either. */
  editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    keyboard?: InlineKeyboard | null
  ): Promise<void>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function createTelegramApi(
  token: string,
  fetchImpl: FetchLike = fetch
): TelegramApi {
  async function call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${API_BASE}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Network failure or timeout. The message of a fetch error does not
      // include the URL, but the name is all that is reported regardless.
      const reason = err instanceof Error ? err.name : "unknown error";
      throw new TelegramApiError(method, null, `request failed (${reason})`);
    }

    let body: { ok?: boolean; result?: T; error_code?: number; description?: string };
    try {
      body = await res.json();
    } catch {
      throw new TelegramApiError(method, res.status, "unreadable response");
    }
    if (!body.ok) {
      throw new TelegramApiError(
        method,
        body.error_code ?? res.status,
        (body.description ?? "no description").slice(0, 300)
      );
    }
    return body.result as T;
  }

  return {
    async sendMessage(chatId, text, keyboard) {
      return call<{ message_id: number }>("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
      });
    },

    async editMessageText(chatId, messageId, text, keyboard) {
      try {
        await call("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text,
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          reply_markup: { inline_keyboard: keyboard ?? [] },
        });
      } catch (err) {
        // A redraw that changes nothing (a double tap) is refused by
        // Telegram with this description. The message already says the
        // right thing, so it is not a failure.
        if (
          err instanceof TelegramApiError &&
          /message is not modified/i.test(err.description)
        ) {
          return;
        }
        throw err;
      }
    },

    async answerCallbackQuery(callbackQueryId, text) {
      await call("answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        ...(text ? { text } : {}),
      });
    },
  };
}
