import { NextResponse } from "next/server";
import webpush, { type WebPushError } from "web-push";

import { createAdminClient } from "@/lib/supabase/admin";
import { istDayContext } from "@/lib/date";

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

function isExpiredError(err: unknown): boolean {
  const status = (err as WebPushError)?.statusCode;
  return status === 404 || status === 410;
}

/**
 * Minutes to credit toward "time spent" stats: real elapsed time when tracked,
 * else the target for naturally-completed sessions, else 0 (untracked AND never
 * completed — unrecoverable, not a regression).
 */
function creditedMinutes(s: {
  elapsed_seconds: number | null;
  completed: boolean;
  duration_minutes: number;
}): number {
  if (s.elapsed_seconds !== null) return s.elapsed_seconds / 60;
  if (s.completed) return s.duration_minutes;
  return 0;
}

interface TinyWinsStats {
  tasks_completed: number;
  focus_minutes: number;
  cards_reviewed: number;
}

function buildTinyWinsMessage(stats: TinyWinsStats): string {
  const parts: string[] = [];
  if (stats.tasks_completed > 0) {
    parts.push(
      `${stats.tasks_completed} task${stats.tasks_completed > 1 ? "s" : ""} done`
    );
  }
  if (stats.focus_minutes > 0) {
    parts.push(`${stats.focus_minutes}min focused`);
  }
  if (stats.cards_reviewed > 0) {
    parts.push(`${stats.cards_reviewed} cards reviewed`);
  }
  return parts.join(" · ");
}

// POST /api/push/tinywin — cron-triggered daily wins summary (9 PM IST).
export async function POST(request: Request) {
  if (request.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return json({ data: null, error: "Unauthorized" }, 401);
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );

  const supabase = createAdminClient();
  const { startOfToday } = istDayContext();

  const { data: subs, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth");

  if (subsError) return json({ data: null, error: subsError.message }, 500);

  // Group subscriptions by user.
  const byUser = new Map<string, { endpoint: string; p256dh: string; auth: string }[]>();
  for (const sub of subs ?? []) {
    const list = byUser.get(sub.user_id) ?? [];
    list.push(sub);
    byUser.set(sub.user_id, list);
  }

  let sent = 0;

  for (const [userId, userSubs] of Array.from(byUser.entries())) {
    const [tasksRes, focusRes, reviewsRes] = await Promise.all([
      supabase
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "done")
        .gte("updated_at", startOfToday),
      supabase
        .from("focus_sessions")
        .select("duration_minutes, completed, elapsed_seconds")
        .eq("user_id", userId)
        .gte("ended_at", startOfToday),
      supabase
        .from("srs_reviews")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("reviewed_at", startOfToday),
    ]);

    const stats: TinyWinsStats = {
      tasks_completed: tasksRes.count ?? 0,
      focus_minutes: Math.round(
        (focusRes.data ?? []).reduce((sum, s) => sum + creditedMinutes(s), 0)
      ),
      cards_reviewed: reviewsRes.count ?? 0,
    };

    // Don't ping users who did nothing today.
    if (
      stats.tasks_completed === 0 &&
      stats.focus_minutes === 0 &&
      stats.cards_reviewed === 0
    ) {
      continue;
    }

    const payload = JSON.stringify({
      title: "Today's wins 🏆",
      body: buildTinyWinsMessage(stats),
      url: "/dashboard",
    });

    let delivered = false;
    for (const sub of userSubs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload
        );
        delivered = true;
      } catch (err) {
        if (isExpiredError(err)) {
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", sub.endpoint);
        }
      }
    }
    if (delivered) sent += 1;
  }

  return json<{ sent: number }>({ data: { sent }, error: null });
}
