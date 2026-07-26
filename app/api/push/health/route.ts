import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PushHealthData {
  /** push_health heartbeat: last time /api/push/due ran at all. */
  lastInvocationAt: string | null;
  /** push_health heartbeat: last time a push was actually delivered. */
  lastDeliveryAt: string | null;
  /** This user's registered push devices. */
  subscriptionCount: number;
  /** This user's reminders past due and still undelivered (is_sent = false). */
  overdueUndeliveredCount: number;
  /**
   * Server clock at response time. The banner derives "hasn't run in Xm" from
   * (now - lastInvocationAt) — using the browser clock instead would turn any
   * device clock drift into a false alarm.
   */
  now: string;
}

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

/** How far back a reminder must be to count as "overdue and undelivered". */
const OVERDUE_GRACE_MS = 5 * 60 * 1000;

/**
 * GET /api/push/health — read-only observability for the reminder push
 * pipeline, surfaced by the dashboard banner.
 *
 * Auth is a normal user session (NOT the cron secret — this is user-facing).
 * push_health has RLS enabled with no policies, so it is unreadable by the
 * session client; only that one table goes through the service-role client.
 * The per-user counts deliberately stay on the session client so RLS scopes
 * them to the caller. No raw log rows are ever returned.
 */
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  const admin = createAdminClient();
  const overdueBefore = new Date(Date.now() - OVERDUE_GRACE_MS).toISOString();

  const [healthRes, subsRes, overdueRes] = await Promise.all([
    // push_health is a single row keyed id = true. Not in types/database.ts
    // (service-role only, no client-side reads) — same escape hatch the
    // /api/push/due writer uses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any)
      .from("push_health")
      .select("last_invocation_at, last_delivery_at")
      .eq("id", true)
      .maybeSingle(),
    supabase
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("reminders")
      .select("id", { count: "exact", head: true })
      .eq("is_sent", false)
      .lt("remind_at", overdueBefore),
  ]);

  const firstError = healthRes.error ?? subsRes.error ?? overdueRes.error;
  if (firstError) return json({ data: null, error: firstError.message }, 500);

  const health = healthRes.data as {
    last_invocation_at: string | null;
    last_delivery_at: string | null;
  } | null;

  const data: PushHealthData = {
    lastInvocationAt: health?.last_invocation_at ?? null,
    lastDeliveryAt: health?.last_delivery_at ?? null,
    subscriptionCount: subsRes.count ?? 0,
    overdueUndeliveredCount: overdueRes.count ?? 0,
    now: new Date().toISOString(),
  };
  return json<PushHealthData>({ data, error: null });
}
