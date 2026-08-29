import webpush from "web-push";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Send one web push to every device a user has registered. SERVER-ONLY
 * (service-role client + VAPID private key).
 *
 * BEST EFFORT, BY DESIGN. This never throws and never reports success to the
 * caller as anything more than a count. A push is a courtesy on top of work
 * that has already been persisted — the YouTube note job creates its note and
 * marks itself completed BEFORE calling this, so a dead subscription, an
 * unreachable push service or missing VAPID config cannot cost the user their
 * note. Callers should not await this in a way that can fail their own path.
 *
 * Delivery is not guaranteed even on success: `sent` counts pushes the push
 * SERVICE accepted, not notifications a person saw. iOS in particular only
 * surfaces these from an installed PWA, and a fully closed app may never
 * receive one.
 *
 * Existing cron push routes (/api/push/due, /api/push/tinywin) call
 * setVapidDetails inside their handler; this module does it lazily on first
 * send instead. Doing it at import time would make a missing VAPID env var
 * throw when the route MODULE loads, which would take down note generation
 * itself — exactly the coupling "best effort" is supposed to prevent.
 */

/** Socket-inactivity bound on the outbound request. Matches /api/push/due. */
const PUSH_SEND_TIMEOUT_MS = 5000;

/** null = not attempted yet; false = env incomplete, don't retry per call. */
let vapidConfigured: boolean | null = null;

function ensureVapidConfigured(): boolean {
  if (vapidConfigured !== null) return vapidConfigured;
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) {
    console.warn("[push] VAPID env vars missing — push send skipped");
    vapidConfigured = false;
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
  } catch (err) {
    console.error("[push] setVapidDetails failed", err);
    vapidConfigured = false;
  }
  return vapidConfigured;
}

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; url: string }
): Promise<{ sent: number; failed: number }> {
  if (!ensureVapidConfigured()) return { sent: 0, failed: 0 };

  let subs: { endpoint: string; p256dh: string; auth: string }[] | null = null;
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", userId);
    subs = data;
  } catch (err) {
    console.error("[push] subscription lookup failed", err);
    return { sent: 0, failed: 0 };
  }
  if (!subs?.length) return { sent: 0, failed: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { timeout: PUSH_SEND_TIMEOUT_MS }
      );
      sent += 1;
    } catch {
      // Deliberately NOT pruning 404/410 rows here, unlike /api/push/due.
      // That pruning belongs to the cron paths that sweep every user; a
      // best-effort side call should not delete rows as a side effect.
      failed += 1;
    }
  }
  return { sent, failed };
}
