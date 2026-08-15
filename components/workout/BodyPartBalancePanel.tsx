"use client";

import { AlertCircle, Dumbbell } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  formatDaysSince,
  type BodyPartLoad,
} from "@/lib/workout-analysis";
import { useWorkoutAnalysis } from "@/hooks/useWorkoutAnalysis";
import { EmptyState } from "@/components/shared/EmptyState";

/**
 * Which muscle groups are undertrained, most neglected first.
 *
 * THIS IS THE HALF THAT WORKS ON TODAY'S DATA. Progressive overload needs an
 * exercise repeated across two days and has none; balance needs only that sets
 * exist, and 15 of them are already decisive — Back carries 80% of every set
 * logged while Legs, Shoulders, Arms and Core have never been trained at all.
 * A feature that only became useful at 200 rows would have nothing to say for
 * months; this one is at its most useful precisely when the history is thin.
 *
 * Untrained groups render MUTED, never in `danger`. The zero is the finding
 * and it speaks for itself; colouring it red would turn a training observation
 * into a reprimand, and the app does not know why someone skipped legs.
 */
export function BodyPartBalancePanel() {
  const { data, isLoading, isError } = useWorkoutAnalysis();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 animate-pulse rounded bg-surface-raised" />
        <div className="h-8 animate-pulse rounded bg-surface-raised" />
        <div className="h-8 animate-pulse rounded bg-surface-raised" />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Couldn't load balance"
        description="Logging still works."
        density="compact"
      />
    );
  }

  const parts = data?.bodyParts ?? [];
  const trained = parts.filter((p) => p.sets > 0).length;

  if (trained === 0) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Dumbbell aria-hidden className="h-3.5 w-3.5 shrink-0" />
        Nothing logged yet — balance appears once you log your first set.
      </p>
    );
  }

  /**
   * Bars are scaled against the BIGGEST group, not against the total.
   *
   * With one dominant group a share-of-total scale leaves every other bar a
   * sliver: Back's 80% would render four times Chest's 20% and the four zeros
   * would be invisible anyway. Against the max, Back fills the row and Chest
   * shows a legible quarter of it — the same ratio, actually readable at
   * 375px. The printed percentage stays share-of-total, which is the number
   * that means something.
   */
  const maxSets = parts.reduce((n, p) => (p.sets > n ? p.sets : n), 0);

  return (
    <ul className="space-y-4">
      {parts.map((part) => (
        <BalanceRow
          key={part.bodyPart}
          part={part}
          maxSets={maxSets}
          windowDays={data?.windowDays ?? 0}
        />
      ))}
    </ul>
  );
}

function BalanceRow({
  part,
  maxSets,
  windowDays,
}: {
  part: BodyPartLoad;
  maxSets: number;
  windowDays: number;
}) {
  const untrained = part.sets === 0;
  const pct = maxSets === 0 ? 0 : (part.sets / maxSets) * 100;

  return (
    <li>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-mono text-xs font-medium uppercase tracking-[0.1em]",
            untrained ? "text-muted-foreground" : "text-foreground"
          )}
        >
          {part.bodyPart}
        </span>
        <span
          className={cn(
            "shrink-0 font-mono text-xs tabular-nums",
            untrained ? "text-muted-foreground" : "text-foreground"
          )}
        >
          {part.sets} set{part.sets === 1 ? "" : "s"}
        </span>
      </div>

      {/* 8 from the label to the bar — one object. The track always renders, so
          an untrained group still occupies a full row rather than collapsing
          to a line of text and losing its place in the ranking. */}
      <div
        aria-hidden
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-raised"
      >
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="mt-2 font-mono text-xs tabular-nums text-muted-foreground">
        {untrained ? (
          // Scoped to the window, NOT "Never trained". The analysis reads 180
          // days; a group last trained 200 days ago is invisible to it, and
          // flatly asserting "never" would be the app stating as fact
          // something it cannot see. The window is named so the claim is
          // exactly as strong as the evidence.
          `Nothing in the last ${windowDays} days`
        ) : (
          <>
            {Math.round(part.share * 100)}% of sets · {part.exercises} exercise
            {part.exercises === 1 ? "" : "s"} ·{" "}
            {formatDaysSince(part.daysSince ?? 0)}
          </>
        )}
      </p>
    </li>
  );
}
