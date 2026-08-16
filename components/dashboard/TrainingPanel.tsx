"use client";

import { useIsRestoring } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { useWorkoutAnalysis } from "@/hooks/useWorkoutAnalysis";
import {
  formatChange,
  formatCivilDate,
  formatDaysSince,
  formatSessionTopSet,
  type ProgressDirection,
} from "@/lib/workout-analysis";
import { SectionPanel } from "@/components/dashboard/SectionPanel";
import { MonoLabel } from "@/components/shared/MonoLabel";
import { EmptyState } from "@/components/shared/EmptyState";

/** How many exercises the dashboard shows. The full list is the workout page. */
const PROGRESSION_LIMIT = 3;

/**
 * A lighter session is INFORMATION, not a fault — deload, bad sleep, a
 * different rep target. The app does not know which, so a downward change is
 * `warning` and never `danger`. Same reasoning as the workout page's panels;
 * this is the established rule, not a new one.
 */
const DIRECTION_TINT: Record<ProgressDirection, string> = {
  up: "text-success",
  down: "text-warning",
  same: "text-muted-foreground",
};

/**
 * Training drift: when you last trained, what each body part is owed, and
 * whether the weight is moving.
 *
 * Sources the PR #43 analysis endpoint (180 IST days) rather than the logging
 * cache (21 days). That split is load-bearing: at 21 days the only baseline
 * four of five exercises have would drop out of the window, and every
 * progression row would silently become a first-ever session.
 *
 * NO CHART, deliberately. On the real table no exercise has been logged on two
 * different days, so a line chart is a single dot — which reads as broken
 * rather than as new. Rows state the top set and gain a delta only once there
 * is a second session to compare against.
 */
export function TrainingPanel() {
  const { data, isLoading, isError } = useWorkoutAnalysis();
  // isLoading reads false throughout an IndexedDB restore, so it could never
  // be the gate on its own — same reason every other persisted-cache reader
  // pairs the two (PR #36).
  const restoring = useIsRestoring() || isLoading;

  if (restoring) {
    return (
      <SectionPanel title="Training" variant="plain">
        <div className="h-5 w-40 animate-pulse rounded bg-surface-raised" />
      </SectionPanel>
    );
  }

  // A failed read must be visibly distinct from genuinely having no history —
  // otherwise a broken query renders as "you have never trained".
  if (isError) {
    return (
      <SectionPanel title="Training" variant="plain">
        <EmptyState
          icon={AlertCircle}
          title="Couldn't load your training history"
          description="Try refreshing."
          density="compact"
        />
      </SectionPanel>
    );
  }

  // Nothing logged in the whole window: the section has no content, so it does
  // not render. The Workout nav tab is the entry point, not a placeholder here.
  if (!data || data.totalSets === 0) return null;

  const progressions = data.progressions.slice(0, PROGRESSION_LIMIT);
  const trained = data.bodyParts.filter((b) => b.daysSince !== null);
  const untrained = data.bodyParts.filter((b) => b.daysSince === null);

  return (
    <SectionPanel
      title="Training"
      href="/dashboard/workout"
      linkLabel="View all"
      variant="plain"
    >
      {/* Last session — the one line that answers "am I drifting?". */}
      {data.lastSessionDate && (
        <p className="text-sm text-foreground">
          Last session{" "}
          <span className="font-mono tabular-nums">
            {formatCivilDate(data.lastSessionDate)}
          </span>
          <span className="text-muted-foreground">
            {" "}
            · {data.sessionDays} session{data.sessionDays === 1 ? "" : "s"} in{" "}
            {data.windowDays} days
          </span>
        </p>
      )}

      {progressions.length > 0 && (
        <div className="mt-4">
          <MonoLabel as="p">Progression</MonoLabel>
          <ul className="mt-2 divide-y">
            {progressions.map((p) => (
              <li
                key={p.key}
                className="flex items-center justify-between gap-4 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">
                    {p.exercise}
                  </p>
                  <p className="mt-2 font-mono text-xs tabular-nums text-muted-foreground">
                    {formatSessionTopSet(p.latest)} ·{" "}
                    {formatCivilDate(p.latest.date)}
                  </p>
                </div>
                {/* One session is a BASELINE, not a zero change — a "0 kg"
                    chip would assert a comparison that has not happened. */}
                <span
                  className={cn(
                    "shrink-0 font-mono text-xs tabular-nums",
                    p.change
                      ? DIRECTION_TINT[p.change.direction]
                      : "text-muted-foreground/60"
                  )}
                >
                  {p.change ? formatChange(p.change) : "First session"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.bodyParts.length > 0 && (
        <div className="mt-4">
          <MonoLabel as="p">Body parts</MonoLabel>
          <ul className="mt-2 flex flex-wrap gap-2">
            {trained.map((b) => (
              <li
                key={b.bodyPart}
                className="rounded-md bg-surface-raised px-2 py-1 text-xs text-foreground"
              >
                {b.bodyPart}{" "}
                <span className="font-mono tabular-nums text-muted-foreground">
                  {formatDaysSince(b.daysSince as number).toLowerCase()}
                </span>
              </li>
            ))}
            {untrained.map((b) => (
              // Muted, not alarming: an untrained group is information. And it
              // reads "nothing in N days", never "never" — the analysis cannot
              // see past its window, so "never" would assert what it has no
              // evidence for.
              <li
                key={b.bodyPart}
                className="rounded-md bg-surface-raised px-2 py-1 text-xs text-muted-foreground/70"
              >
                {b.bodyPart}{" "}
                <span className="font-mono tabular-nums">
                  nothing in {data.windowDays}d
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionPanel>
  );
}
