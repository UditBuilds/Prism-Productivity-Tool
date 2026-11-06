import { isAuthorizedUpdate } from "@/lib/telegram/auth";
import { parseCallbackData } from "@/lib/telegram/callback-data";

/**
 * [tg-timing] — one compact line per webhook delivery. It changes nothing the
 * bot does.
 *
 *   [tg-timing] at=2026-11-07T05:31:02.123Z u=777 q=90abcdef btn=p:d:8de86e8e
 *     region=icn1 via=ams1 cold=false uptime=412.3s sha=abc1234 ack=+212ms:ok
 *     apply=+268ms:ok view=+301ms:ok edit=+610ms:ok db=6/190ms total=+612ms
 *
 * Every +Nms is since this request started, at the moment that step FINISHED,
 * in the order the steps ran; db is queries/summed time.
 *
 * It cannot see anything before the request reached this function: the phone,
 * Telegram's delivery, or a queue behind an earlier tap. `at=` is there to set
 * against when the button was really tapped (callback_query has no timestamp),
 * and two lines with the same `u=` are a redelivery. `cold=true` with a small
 * `uptime` is a cold start, and that boot time is not in the +Nms either.
 *
 * NEVER LOGGED: the bot token (it is in every Bot API URL), the webhook secret,
 * message text, and query strings. A request that fails the gate logs nothing
 * from its body.
 */

/** Deliveries this instance has served: 1 on the first means it just booted. */
let deliveriesServed = 0;

const MAX_REASON_CHARS = 120;

type FetchLike = typeof fetch;

export interface TapTimer {
  /** Adds a word to the line, for an exit that has no step to time. */
  note(field: string): void;
  /** Runs the same gate as the handler, only to decide what may be logged. */
  identify(
    rawBody: string,
    secretHeader: string | null,
    env: { webhookSecret: string; allowedChatId: string }
  ): void;
  /**
   * The same function, adding `name=+Nms:outcome` to the line when it finishes.
   * `describe` names the outcome of a call that resolved (default "ok").
   */
  step<A extends unknown[], R>(
    name: string,
    fn: (...args: A) => Promise<R>,
    describe?: (result: R) => string
  ): (...args: A) => Promise<R>;
  /** For the Supabase client: counts queries and their time. */
  timedFetch: FetchLike;
  /** Writes the line. Call once, on every way out of the request. */
  finish(): void;
}

function reason(err: unknown): string {
  // TelegramApiError never carries the URL (lib/telegram/client.ts).
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/\s+/g, " ").slice(0, MAX_REASON_CHARS);
}

export function createTapTimer(startedAt: number, vercelId: string | null): TapTimer {
  deliveriesServed += 1;
  const cold = deliveriesServed === 1;
  const uptime = process.uptime();

  const who: string[] = [];
  const steps: string[] = [];
  let dbQueries = 0;
  let dbMs = 0;

  const since = () => `+${Date.now() - startedAt}ms`;

  return {
    note(field) {
      steps.push(field);
    },

    identify(rawBody, secretHeader, env) {
      let update: unknown;
      try {
        update = JSON.parse(rawBody);
      } catch {
        who.push("gate=unparseable");
        return;
      }
      if (!isAuthorizedUpdate(secretHeader, update, env)) {
        who.push("gate=refused");
        return;
      }
      who.push(`u=${update.update_id}`);
      const query = update.callback_query;
      if (!query) {
        who.push("kind=message");
        return;
      }
      const parsed = parseCallbackData(query.data);
      who.push(`q=${query.id.slice(-8)}`);
      who.push(parsed ? `btn=${parsed.namespace}:${parsed.action}:${parsed.id.slice(0, 8)}` : "btn=unparsed");
    },

    step(name, fn, describe) {
      return async (...args) => {
        try {
          const result = await fn(...args);
          steps.push(`${name}=${since()}:${describe ? describe(result) : "ok"}`);
          return result;
        } catch (err) {
          steps.push(`${name}=${since()}:FAILED(${reason(err)})`);
          throw err;
        }
      };
    },

    timedFetch: async (input, init) => {
      const t = Date.now();
      try {
        return await fetch(input, init);
      } finally {
        dbQueries += 1;
        dbMs += Date.now() - t;
      }
    },

    finish() {
      console.log(
        [
          "[tg-timing]",
          `at=${new Date(startedAt).toISOString()}`,
          ...who,
          `region=${process.env.VERCEL_REGION ?? "unknown"}`,
          // "ams1::…": where the request entered Vercel.
          `via=${(vercelId ?? "unknown").split("::")[0]}`,
          `cold=${cold}`,
          `uptime=${uptime.toFixed(1)}s`,
          `sha=${(process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown").slice(0, 7)}`,
          ...steps,
          `db=${dbQueries}/${dbMs}ms`,
          `total=${since()}`,
        ].join(" ")
      );
    },
  };
}
