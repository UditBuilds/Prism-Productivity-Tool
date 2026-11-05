import webpush, { type WebPushError } from "web-push";

import { json } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTelegramApi, TelegramApiError } from "@/lib/telegram/client";
import { readNotifyChannel, readTelegramEnv, wantsTelegram } from "@/lib/telegram/env";
import {
  claimReminder,
  recordTelegramDelivery,
  releaseClaim,
  renderReminderMessage,
} from "@/lib/telegram/reminder-claims";

function isExpiredError(err: unknown): boolean {
  const status = (err as WebPushError)?.statusCode;
  return status === 404 || status === 410;
}

/**
 * Socket timeout on the outbound push request.
 *
 * Defence in depth behind the write-time endpoint allowlist in
 * lib/push/endpoint.ts: even if a hostile endpoint ever reached the table,
 * this bounds how long it can hold the cron open. Without it a slow-loris
 * endpoint stalls the whole loop — every user's reminders sit behind it until
 * the function's 60s ceiling kills the invocation.
 *
 * web-push maps this onto the Node socket timeout, which fires on socket
 * inactivity rather than total response time (see the option's own docs), so
 * it is a bound on stalling, not a hard deadline on the request.
 */
const PUSH_SEND_TIMEOUT_MS = 5000;

/**
 * Throttle for auth-failure logging. See the 401 branch in POST.
 *
 * Module-level, so it is per warm serverless instance rather than global — a
 * distributed flood across many cold starts still writes more than one row per
 * minute. That is accepted: the goal is removing the unbounded 1-row-per-request
 * amplification, and any cross-instance alternative would need the DB read per
 * attempt that this exists to avoid.
 */
const AUTH_FAIL_LOG_INTERVAL_MS = 60_000;
let lastAuthFailLoggedAt = 0;

/** Config warnings are logged once per warm instance, not every minute. */
let reminderConfigWarned = false;

// Thin wrapper: write a log row but never throw — a logging failure must not
// break or slow delivery.
async function logRow(
  supabase: ReturnType<typeof createAdminClient>,
  row: Record<string, unknown>,
) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("push_delivery_log").insert(row);
  } catch (err) {
    console.error("[push-observability] write failed", err);
  }
}

// Thin wrapper: upsert push_health — same best-effort contract.
async function upsertHealth(
  supabase: ReturnType<typeof createAdminClient>,
  fields: Record<string, unknown>,
) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("push_health").upsert({ id: true, ...fields });
  } catch (err) {
    console.error("[push-observability] write failed", err);
  }
}

// POST /api/push/due — cron-triggered: deliver pushes for due reminders.
export async function POST(request: Request) {
  // Guard: only the scheduler (with the shared secret) may call this.
  if (request.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    // The auth_fail row is kept — it is the signal that would have caught the
    // three-week 401 outage on day one — but SAMPLED rather than written per
    // request. Unauthenticated callers control how often this runs, so a row
    // per attempt let anyone who could reach the URL write to the table without
    // limit.
    //
    // Sampled, not dropped, because dropping loses the outage signal entirely.
    // The first miss in each window still logs, so a misconfigured cron —
    // which retries on a schedule, not in a burst — is recorded exactly as
    // before; only a flood is collapsed.
    //
    // The timestamp is claimed BEFORE the await so concurrent misses on the
    // same instance can't all pass the gate while the first insert is in
    // flight. A suppressed miss makes no DB call at all: createAdminClient()
    // stays inside the branch.
    const now = Date.now();
    if (now - lastAuthFailLoggedAt >= AUTH_FAIL_LOG_INTERVAL_MS) {
      lastAuthFailLoggedAt = now;
      await logRow(createAdminClient(), {
        invocation_id: crypto.randomUUID(),
        event: "auth_fail",
      });
    }
    return json({ data: null, error: "Unauthorized" }, 401);
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );

  // Service-role client: must read every user's reminders/subscriptions.
  const supabase = createAdminClient();

  // One invocation_id for every row written during this call.
  const invocationId = crypto.randomUUID();

  const nowIso = new Date().toISOString();
  // Two gates, not one. `is_sent = false` excludes anything already delivered
  // (including by the in-app NotificationChecker, which flips the boolean
  // directly). `delivery_status = 'pending'` excludes reminders that reached a
  // terminal outcome without a delivery — today that is only
  // 'skipped_no_device', below. Dropping either gate reopens a retry loop:
  // without the first, a client-delivered reminder is pushed a second time;
  // without the second, a reminder with nothing to deliver to is re-matched on
  // every tick, forever.
  const { data: dueReminders, error: remindersError } = await supabase
    .from("reminders")
    .select("id, user_id, title, body")
    .lte("remind_at", nowIso)
    .eq("is_sent", false)
    .eq("delivery_status", "pending");

  if (remindersError) {
    return json({ data: null, error: remindersError.message }, 500);
  }

  const matched = (dueReminders ?? []).length;

  // Log invocation + update heartbeat.
  await logRow(supabase, {
    invocation_id: invocationId,
    event: "invocation",
    reminders_matched: matched,
    ok: true,
  });
  await upsertHealth(supabase, { last_invocation_at: new Date().toISOString() });

  let sent = 0;
  let skipped = 0;

  // TELEGRAM, FOR THE OWNER ONLY. REMINDER_NOTIFY_CHANNEL = webpush |
  // telegram | both (unset = both) decides where PRISM_OWNER_USER_ID's
  // reminders go. Every other user's reminder takes exactly the path below
  // it always took. The owner's go through a claim first
  // (lib/telegram/reminder-claims.ts) so overlapping runs, or a run that
  // crashed after Telegram accepted the message, never send one twice.
  const reminderChannel = readNotifyChannel(process.env.REMINDER_NOTIFY_CHANNEL);
  const bot = readTelegramEnv();
  if (!reminderConfigWarned) {
    if (!reminderChannel.valid) {
      console.warn("[push-due] REMINDER_NOTIFY_CHANNEL is not webpush|telegram|both; using both");
    }
    if (reminderChannel.channel === "telegram" && !bot) {
      console.warn("[push-due] REMINDER_NOTIFY_CHANNEL=telegram but the bot is not configured; using web push");
    }
    reminderConfigWarned = true;
  }
  const telegram =
    bot && wantsTelegram(reminderChannel.channel) ? createTelegramApi(bot.botToken) : null;

  for (const reminder of dueReminders ?? []) {
    let delivered = false;
    // Set only while this run holds the owner's claim on this reminder.
    let claim: { claimId: string; telegramMessageId: number | null } | null = null;
    let telegramFailed = false;

    if (telegram && bot && reminder.user_id === bot.ownerUserId) {
      const claimed = await claimReminder(supabase, reminder, Date.now());
      // Another run is delivering it right now: not ours to touch.
      if (claimed.kind === "busy") continue;
      if (claimed.kind === "unavailable") {
        // Without a claim, a double send can't be ruled out — so no Telegram
        // this time; the reminder takes the web-push path below, as today.
        console.error(`[push-due] reminder ${reminder.id}: ${claimed.reason}; using web push`);
      } else {
        claim = claimed;
        if (claimed.telegramMessageId !== null) {
          // A run that crashed AFTER Telegram accepted this reminder left the
          // claim behind. It was delivered: mark it, send nothing.
          delivered = true;
        } else {
          try {
            const message = await telegram.sendMessage(
              bot.allowedChatId,
              renderReminderMessage(reminder.title, reminder.body)
            );
            delivered = true;
            await recordTelegramDelivery(supabase, claimed.claimId, reminder.user_id, message.message_id);
            await logRow(supabase, {
              invocation_id: invocationId,
              event: "attempt",
              reminder_id: reminder.id,
              subscription_endpoint: "telegram",
              status_code: 200,
              ok: true,
            });
          } catch (err) {
            telegramFailed = true;
            const reason =
              err instanceof TelegramApiError
                ? err.description
                : err instanceof Error
                  ? err.message
                  : String(err);
            console.error(
              `[push-due] Telegram reminder ${reminder.id} failed: ${reason}${
                reminderChannel.channel === "telegram" ? " — trying web push instead" : ""
              }`
            );
            await logRow(supabase, {
              invocation_id: invocationId,
              event: "attempt",
              reminder_id: reminder.id,
              subscription_endpoint: "telegram",
              status_code: err instanceof TelegramApiError ? err.code : null,
              ok: false,
              error_text: reason.slice(0, 500),
            });
          }
        }
      }
    }

    // Web push: always for everyone else; for the owner, on "both", or as
    // the fallback when Telegram failed. Never after a takeover that found
    // Telegram already delivered.
    const pushWanted =
      claim === null ||
      (claim.telegramMessageId === null &&
        (reminderChannel.channel === "both" || telegramFailed));

    if (pushWanted) {
      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .eq("user_id", reminder.user_id);

      // No registered device: the per-subscription loop below would not run a
      // single iteration, so nothing succeeds, nothing fails, and `delivered`
      // stays false — which used to leave the row exactly as it was found and
      // hand it straight back to the next tick. Measured before this branch
      // existed: one reminder re-matched every minute for seven weeks with zero
      // rows in push_delivery_log.
      //
      // Resolve it to a terminal status instead. `is_sent` stays false because
      // nothing was sent; only the retry stops. The reminder is not lost — it
      // still lists and still fires in-app if the user opens Prism, and
      // registering a device does not resurrect a delivery that is already
      // weeks stale.
      // (A Telegram delivery already made is not "no device": skip the push.)
      if ((subs ?? []).length === 0 && !delivered) {
        await supabase
          .from("reminders")
          .update({ delivery_status: "skipped_no_device" })
          .eq("id", reminder.id);

        await logRow(supabase, {
          invocation_id: invocationId,
          event: "skip_no_device",
          reminder_id: reminder.id,
          ok: true,
        });

        if (claim) await releaseClaim(supabase, claim.claimId, reminder.user_id);
        skipped += 1;
        continue;
      }

      const payload = JSON.stringify({
        title: reminder.title,
        body: reminder.body || "Prism reminder",
        url: "/dashboard/reminders",
      });

      for (const sub of subs ?? []) {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
            { timeout: PUSH_SEND_TIMEOUT_MS },
          );
          delivered = true;

          // Log successful attempt. AWAITED on purpose (despite the cost to the
          // loop): an un-awaited insert can be dropped when the serverless
          // instance freezes after the response is sent.
          await logRow(supabase, {
            invocation_id: invocationId,
            event: "attempt",
            reminder_id: reminder.id,
            subscription_endpoint: logSafeEndpoint(sub.endpoint),
            status_code: 201,
            ok: true,
          });
        } catch (err) {
          const status = (err as WebPushError)?.statusCode;
          const body =
            (err as WebPushError)?.body ?? (err as Error)?.message ?? String(err);
          const errorText =
            typeof body === "string" ? body.slice(0, 500) : String(body).slice(0, 500);

          // Log failed attempt.
          await logRow(supabase, {
            invocation_id: invocationId,
            event: "attempt",
            reminder_id: reminder.id,
            subscription_endpoint: logSafeEndpoint(sub.endpoint),
            status_code: status ?? null,
            ok: false,
            error_text: errorText,
          });

          // Expired/invalid subscription → prune it + log the prune event.
          if (isExpiredError(err)) {
            await supabase
              .from("push_subscriptions")
              .delete()
              .eq("endpoint", sub.endpoint);

            await logRow(supabase, {
              invocation_id: invocationId,
              event: "prune",
              subscription_endpoint: logSafeEndpoint(sub.endpoint),
              ok: true,
            });
          }
        }
      }
    }

    // Mark the reminder as sent once it has actually been delivered. On failure
    // we leave the row untouched (is_sent stays false) so the next cron tick
    // retries it. Delivered reminders stay visible in the Sent tab with a
    // "Sent" status, consistent with the client-side NotificationChecker path.
    if (!delivered && claim) {
      // Nothing reached the owner: give the claim back so the next tick
      // retries both channels, exactly as an undelivered push is retried.
      await releaseClaim(supabase, claim.claimId, reminder.user_id);
    }
    if (delivered) {
      await supabase
        .from("reminders")
        .update({ is_sent: true, delivery_status: "delivered" })
        .eq("id", reminder.id);

      // Log mark_sent + update heartbeat.
      await logRow(supabase, {
        invocation_id: invocationId,
        event: "mark_sent",
        reminder_id: reminder.id,
        ok: true,
      });
      await upsertHealth(supabase, { last_delivery_at: new Date().toISOString() });

      sent += 1;
    }
  }

  return json<{ sent: number; skipped: number }>({
    data: { sent, skipped },
    error: null,
  });
}

/**
 * Endpoint URLs may carry sensitive tokens in query strings — strip everything
 * after the origin + path prefix so we never log auth material.  Returns a
 * safe prefix like "https://fcm.googleapis.com/fcm/send/abc..." (first 120
 * chars) or falls back to the origin-only.
 */
function logSafeEndpoint(endpoint: string): string {
  try {
    const u = new URL(endpoint);
    return (u.origin + u.pathname).slice(0, 120);
  } catch {
    return endpoint.slice(0, 120);
  }
}
