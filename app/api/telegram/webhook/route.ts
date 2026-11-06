import { parseTelegramCapture } from "@/lib/ai/client";
import { checkAiRateLimit } from "@/lib/ai/rateLimit";
import { applyDailyPlanEdit } from "@/lib/daily-plan/edit";
import { readDailyPlanView } from "@/lib/daily-plan/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTelegramApi } from "@/lib/telegram/client";
import { missingTelegramEnv, readTelegramEnv } from "@/lib/telegram/env";
import { createTapTimer } from "@/lib/telegram/tap-timing";
import { handleWebhook } from "@/lib/telegram/webhook";

/** One Groq call (8s timeout) plus a few Bot API calls (8s each, at most). */
export const maxDuration = 30;

// THE REGION IS IN vercel.json, NOT HERE: icn1 (Seoul), next to the database, for
// this route only. `export const preferredRegion` would look right and do nothing:
// Vercel's Next.js builder drops it for Node.js functions, and honours only the
// `functions` entry in vercel.json (vercel/vercel, packages/next/src/utils.ts).

/** An empty 200 — the only answer this route ever gives. */
function emptyOk(): Response {
  return new Response(null, { status: 200 });
}

/**
 * POST /api/telegram/webhook — every update Telegram delivers for the Prism
 * bot (registered with setWebhook + secret_token; see the PR's checklist).
 *
 * ALWAYS AN EMPTY 200. Telegram retries any other status, so an error is
 * answered in the chat instead (lib/telegram/webhook.ts) and an unauthorised
 * request gets the same empty 200 as everything else: nothing to learn from
 * it, nothing to retry.
 *
 * Both gates — the secret header and the one allowed chat — are checked in
 * handleWebhook before anything reads the database or calls the AI. The
 * service-role client below is only constructed here (no request is made
 * until a gate has passed); every query behind it filters on
 * PRISM_OWNER_USER_ID, because this route has no user session.
 *
 * Every write and every Bot API call is awaited before this returns: an
 * un-awaited one can be dropped when the instance freezes. A button is answered
 * first (lib/telegram/callbacks.ts), so its spinner does not wait for any of it.
 *
 * Each delivery logs one [tg-timing] line (lib/telegram/tap-timing.ts).
 */
export async function POST(request: Request) {
  const timer = createTapTimer(Date.now(), request.headers.get("x-vercel-id"));
  try {
    const env = readTelegramEnv();
    if (!env) {
      // Names only — never a value.
      console.warn(`[telegram] webhook off: missing ${missingTelegramEnv().join(", ")}`);
      timer.note("env=missing");
      return emptyOk();
    }

    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      timer.note("body=unreadable");
      return emptyOk();
    }

    const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
    timer.identify(rawBody, secretHeader, env);

    const telegram = createTelegramApi(env.botToken);

    try {
      await handleWebhook(
        { secretHeader, rawBody },
        {
          env,
          db: createAdminClient({ fetch: timer.timedFetch }),
          telegram: {
            sendMessage: timer.step("send", telegram.sendMessage),
            editMessageText: timer.step("edit", telegram.editMessageText),
            answerCallbackQuery: timer.step("ack", telegram.answerCallbackQuery),
          },
          plan: {
            applyEdit: timer.step("apply", applyDailyPlanEdit, (outcome) =>
              outcome.status === 200 ? "ok" : `status${outcome.status}`
            ),
            readView: timer.step("view", readDailyPlanView),
          },
          ai: {
            allow: (userId) => checkAiRateLimit(userId).allowed,
            parseCapture: timer.step("ai", parseTelegramCapture),
          },
          now: () => Date.now(),
          newId: () => crypto.randomUUID(),
        }
      );
    } catch (err) {
      // handleWebhook catches its own failures; this is the last line.
      console.error(
        `[telegram] webhook failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return emptyOk();
  } finally {
    timer.finish();
  }
}
