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

// POST /api/push/due — cron-triggered: deliver pushes for due reminders.
export async function POST(request: Request) {
  // Guard: only the scheduler (with the shared secret) may call this.
  if (request.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return json({ data: null, error: "Unauthorized" }, 401);
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );

  // Service-role client: must read every user's reminders/subscriptions.
  const supabase = createAdminClient();

  const nowIso = new Date().toISOString();
  const { data: dueReminders, error: remindersError } = await supabase
    .from("reminders")
    .select("id, user_id, title, body")
    .lte("remind_at", nowIso)
    .eq("is_sent", false);

  if (remindersError) {
    return json({ data: null, error: remindersError.message }, 500);
  }

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

    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload
        );
      } catch (err) {
        // Expired/invalid subscription → prune it silently.
        if (isExpiredError(err)) {
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", sub.endpoint);
        }
      }
    }

    // Mark sent AFTER attempting delivery, regardless of push outcome, so a
    // reminder never re-fires on the next cron tick.
    await supabase
      .from("reminders")
      .update({ is_sent: true })
      .eq("id", reminder.id);
    sent += 1;
  }

  return json<{ sent: number }>({ data: { sent }, error: null });
}
