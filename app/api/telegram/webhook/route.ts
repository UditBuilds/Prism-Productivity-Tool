import { parseTelegramCapture } from "@/lib/ai/client";
import { checkAiRateLimit } from "@/lib/ai/rateLimit";
import { applyDailyPlanEdit } from "@/lib/daily-plan/edit";
import { readDailyPlanView } from "@/lib/daily-plan/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTelegramApi } from "@/lib/telegram/client";
import { missingTelegramEnv, readTelegramEnv } from "@/lib/telegram/env";
import { handleWebhook } from "@/lib/telegram/webhook";

/** One Groq call (8s timeout) plus a few Bot API calls (8s each, at most). */
export const maxDuration = 30;

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
 * un-awaited one can be dropped when the instance freezes.
 */
export async function POST(request: Request) {
  const env = readTelegramEnv();
  if (!env) {
    // Names only — never a value.
    console.warn(`[telegram] webhook off: missing ${missingTelegramEnv().join(", ")}`);
    return emptyOk();
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return emptyOk();
  }

  try {
    await handleWebhook(
      {
        secretHeader: request.headers.get("x-telegram-bot-api-secret-token"),
        rawBody,
      },
      {
        env,
        db: createAdminClient(),
        telegram: createTelegramApi(env.botToken),
        plan: { applyEdit: applyDailyPlanEdit, readView: readDailyPlanView },
        ai: {
          allow: (userId) => checkAiRateLimit(userId).allowed,
          parseCapture: parseTelegramCapture,
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
}
