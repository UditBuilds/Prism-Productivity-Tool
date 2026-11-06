import { isAuthorizedUpdate } from "@/lib/telegram/auth";
import { parseCallbackData } from "@/lib/telegram/callback-data";

/**
 * [tg-timing] — one log line per step of one webhook delivery, for measuring
 * a real tap. MEASUREMENT ONLY: it changes nothing the bot does.
 *
 * Milliseconds since request start cannot see anything that happened BEFORE
 * the request reached this function (the phone, Telegram's delivery queue, a
 * retry). So the first line also carries the absolute time, to set against
 * when the button was really tapped, and every line after the gate carries
 * the update_id, so a redelivery is visible as the same id arriving twice.
 *
 * NEVER LOGGED: the bot token (it is in every Bot API URL), the webhook secret,
 * message text, and query strings. Before the gate has passed, nothing from
 * the request body is logged at all.
 */

/** Deliveries this instance has served: 1 on the first means a cold start. */
let deliveriesServed = 0;

type FetchLike = typeof fetch;

export interface TapTimer {
  mark(step: string): void;
  /** Runs the same gate as the handler, only to decide what may be logged. */
  identify(
    rawBody: string,
    secretHeader: string | null,
    env: { webhookSecret: string; allowedChatId: string }
  ): void;
  /** The same function, with its duration and outcome logged. */
  wrap<A extends unknown[], R>(
    label: string,
    fn: (...args: A) => Promise<R>
  ): (...args: A) => Promise<R>;
  /** For the Supabase client: one line per query. Path only, no query string. */
  timedFetch: FetchLike;
}

function pathOf(input: Parameters<FetchLike>[0]): string {
  const href =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(href).pathname;
  } catch {
    return "unknown";
  }
}

function reason(err: unknown): string {
  // TelegramApiError never carries the URL (lib/telegram/client.ts).
  return err instanceof Error ? err.message : String(err);
}

export function createTapTimer(startedAt: number, vercelId: string | null): TapTimer {
  deliveriesServed += 1;
  let who = "";

  const mark = (step: string) => {
    console.log(`[tg-timing]${who} +${Date.now() - startedAt}ms ${step}`);
  };

  mark(
    [
      "start",
      `at=${new Date(startedAt).toISOString()}`,
      `delivery=${deliveriesServed}`,
      `cold=${deliveriesServed === 1}`,
      `uptime=${process.uptime().toFixed(1)}s`,
      `region=${process.env.VERCEL_REGION ?? "unknown"}`,
      // "ams1::iad1::…": where the request entered Vercel, and where it ran.
      `via=${(vercelId ?? "unknown").split("::").slice(0, 2).join(">")}`,
      `sha=${(process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown").slice(0, 7)}`,
    ].join(" ")
  );

  return {
    mark,

    identify(rawBody, secretHeader, env) {
      let update: unknown;
      try {
        update = JSON.parse(rawBody);
      } catch {
        mark("gate refused: unparseable body");
        return;
      }
      if (!isAuthorizedUpdate(secretHeader, update, env)) {
        mark("gate refused");
        return;
      }
      who = ` u=${update.update_id}`;
      const query = update.callback_query;
      if (query) {
        const parsed = parseCallbackData(query.data);
        who += ` q=${query.id.slice(-8)}`;
        who += parsed
          ? ` btn=${parsed.namespace}:${parsed.action}:${parsed.id.slice(0, 8)}`
          : " btn=unparsed";
      } else {
        who += " kind=message";
      }
      mark("gate ok");
    },

    wrap(label, fn) {
      return async (...args) => {
        const t = Date.now();
        try {
          const result = await fn(...args);
          mark(`${label} ok took=${Date.now() - t}ms`);
          return result;
        } catch (err) {
          mark(`${label} FAILED took=${Date.now() - t}ms: ${reason(err)}`);
          throw err;
        }
      };
    },

    timedFetch: async (input, init) => {
      const t = Date.now();
      const label = `db ${init?.method ?? "GET"} ${pathOf(input)}`;
      try {
        const res = await fetch(input, init);
        mark(`${label} ${res.status} took=${Date.now() - t}ms`);
        return res;
      } catch (err) {
        mark(`${label} FAILED took=${Date.now() - t}ms: ${reason(err)}`);
        throw err;
      }
    },
  };
}
