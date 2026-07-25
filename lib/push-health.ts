import type { PushHealthData } from "@/app/api/push/health/route";

/**
 * How long the scheduler may go without running before it counts as stale.
 * The cron tick is ~1/minute, so 3 minutes tolerates a couple of missed ticks
 * without crying wolf.
 */
export const SCHEDULER_STALE_MS = 3 * 60 * 1000;

/**
 * Derive the banner's warning lines from a health payload.
 *
 * Pure and total: returns [] when the pipeline is healthy, which is what makes
 * the banner render nothing at all rather than an "all good" state.
 */
export function pushHealthWarnings(health: PushHealthData): string[] {
  const warnings: string[] = [];
  const nowMs = Date.parse(health.now);

  // 1. Scheduler stale (or never ran at all).
  if (health.lastInvocationAt === null) {
    warnings.push("Reminder scheduler has never run");
  } else {
    const sinceMs = nowMs - Date.parse(health.lastInvocationAt);
    if (sinceMs > SCHEDULER_STALE_MS) {
      warnings.push(`Reminder scheduler hasn't run in ${formatGap(sinceMs)}`);
    }
  }

  // 2. Nothing to deliver to — pushes silently go nowhere.
  if (health.subscriptionCount === 0) {
    warnings.push("No devices registered for reminders");
  }

  // 3. Reminders that came due and were never delivered.
  const overdue = health.overdueUndeliveredCount;
  if (overdue > 0) {
    warnings.push(
      `${overdue} reminder${overdue === 1 ? "" : "s"} overdue and undelivered`
    );
  }

  return warnings;
}

/** Coarse gap label: minutes under an hour, then hours, then days. */
function formatGap(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
