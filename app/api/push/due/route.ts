import { NextResponse } from "next/server";
import webpush, { type WebPushError } from "web-push";

import { createAdminClient } from "@/lib/supabase/admin";

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

function isExpiredError(err: unknown): boolean {
  const status = (err as WebPushError)?.statusCode;
  return status === 404 || status === 410;
}

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
    // Log auth failure BEFORE returning — this is the row that would have
    // caught the three-week 401 outage on day one.
    const supabase = createAdminClient();
    await logRow(supabase, {
      invocation_id: crypto.randomUUID(),
      event: "auth_fail",
    });
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
  const { data: dueReminders, error: remindersError } = await supabase
    .from("reminders")
    .select("id, user_id, title, body")
    .lte("remind_at", nowIso)
    .eq("is_sent", false);

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

  for (const reminder of dueReminders ?? []) {
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", reminder.user_id);

    const payload = JSON.stringify({
      title: reminder.title,
      body: reminder.body || "Prism reminder",
      url: "/dashboard/reminders",
    });

    let delivered = false;
    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
        );
        delivered = true;

        // Log successful attempt — fire-and-forget, don't serialise the loop.
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

    // Mark the reminder as sent once it has actually been delivered. On failure
    // we leave the row untouched (is_sent stays false) so the next cron tick
    // retries it. Delivered reminders stay visible in the Sent tab with a
    // "Sent" status, consistent with the client-side NotificationChecker path.
    if (delivered) {
      await supabase
        .from("reminders")
        .update({ is_sent: true })
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

  return json<{ sent: number }>({ data: { sent }, error: null });
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
