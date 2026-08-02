"use client";

import { usePushHealth } from "@/hooks/usePushHealth";
import { pushHealthWarnings } from "@/lib/push-health";
import { MonoLabel } from "@/components/shared/MonoLabel";

/**
 * Surfaces reminder-push pipeline failures at the top of the dashboard.
 *
 * Silent when healthy — renders nothing at all. No green state, no "all good"
 * line: this is a rare condition, not a decoration. Loading and error states
 * are also silent (a failed health check must not itself become an alarm).
 *
 * Client island; the dashboard page is a Server Component and stays one.
 */
export function PushHealthBanner() {
  const { data } = usePushHealth();

  const warnings = data ? pushHealthWarnings(data) : [];
  if (warnings.length === 0) return null;

  return (
    <div
      role="status"
      className="mt-4 rounded-xl border border-warning/30 bg-surface-raised px-4 py-3"
    >
      <MonoLabel className="text-warning">Reminder delivery</MonoLabel>
      <ul className="mt-1.5 space-y-1">
        {warnings.map((w) => (
          <li key={w} className="text-sm text-foreground">
            {w}
          </li>
        ))}
      </ul>
    </div>
  );
}
