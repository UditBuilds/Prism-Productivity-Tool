"use client";

import { AlertCircle, Dumbbell, Minus, TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  formatChange,
  formatCivilDate,
  formatSessionTopSet,
  type ExerciseProgression,
} from "@/lib/workout-analysis";
import { useWorkoutAnalysis } from "@/hooks/useWorkoutAnalysis";
import { EmptyState } from "@/components/shared/EmptyState";

/**
 * Progressive overload: one row per exercise, heaviest-set-first.
 *
 * DELIBERATELY NOT A CHART. The real table has five exercises and not one of
 * them has been logged on two different days, so every line chart this could
 * draw would be a single point — an axis, a grid, and one dot, which reads as
 * broken rather than as new. A row that states the top set and the date is
 * true at one session and gains a delta chip at two, with no layout change and
 * nothing that ever looks empty.
 *
 * The "no exercise logged twice yet" note is stated ONCE at section level
 * rather than per row. With five baselines, a per-row "first session" would
 * print the same sentence five times and drown the numbers that differ.
 */
export function WorkoutProgressPanel() {
  const { data, isLoading, isError } = useWorkoutAnalysis();

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="h-4 w-32 animate-pulse rounded bg-surface-raised" />
        <div className="h-12 animate-pulse rounded-md bg-surface-raised" />
        <div className="h-12 animate-pulse rounded-md bg-surface-raised" />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Couldn't load progress"
        description="Logging still works."
        density="compact"
      />
    );
  }

  const progressions = data?.progressions ?? [];

  if (progressions.length === 0) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Dumbbell aria-hidden className="h-3.5 w-3.5 shrink-0" />
        Nothing logged yet — progress appears once you log your first set.
      </p>
    );
  }

  const comparable = data?.comparableExercises ?? 0;

  return (
    <>
      {comparable === 0 && (
        // The honest headline for the current data, not a placeholder. Saying
        // "not enough data" would be vaguer than the truth, which is specific
        // and actionable: repeat ONE exercise and this section starts working.
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          No exercise logged twice yet — these are your starting points. Repeat
          one and its change appears here.
        </p>
      )}

      <ul className="space-y-2">
        {progressions.map((p) => (
          <ProgressRow key={p.key} progression={p} />
        ))}
      </ul>
    </>
  );
}

function ProgressRow({ progression }: { progression: ExerciseProgression }) {
  const { change, latest } = progression;

  // Down is `warning`, never `danger`. A lighter session is information, not a
  // fault — most often a deload, a bad night's sleep, or simply a different
  // rep target. Colouring it red would make the app scold the user for a
  // normal week of training.
  const tone =
    change === null
      ? "text-muted-foreground"
      : change.direction === "up"
        ? "text-success"
        : change.direction === "down"
          ? "text-warning"
          : "text-muted-foreground";

  const Icon =
    change === null
      ? null
      : change.direction === "up"
        ? TrendingUp
        : change.direction === "down"
          ? TrendingDown
          : Minus;

  return (
    <li className="rounded-md border border-transparent bg-surface-raised p-4">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {progression.exercise}
        </span>
        <span className="shrink-0 font-mono text-sm tabular-nums text-foreground">
          {formatSessionTopSet(latest)}
        </span>
      </div>

      {/* 8 inside one object. The meta line carries the body part and the day
          the top set happened, so a number is never shown without saying when
          it was true. */}
      <div className="mt-2 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
          {progression.bodyPart ?? "Other"} · {formatCivilDate(latest.date)}
        </span>
        {change && Icon && (
          <span
            className={cn(
              "flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums",
              tone
            )}
          >
            <Icon aria-hidden className="h-3 w-3" />
            {formatChange(change)}
            {/* The comparison is meaningless without its baseline date, and
                "+5 kg" alone invites the reader to supply their own. */}
            <span className="sr-only">
              {" "}
              since {formatCivilDate(change.from.date)}
            </span>
          </span>
        )}
      </div>

      {change && (
        <p className="mt-2 font-mono text-xs tabular-nums text-muted-foreground">
          was {formatSessionTopSet(change.from)} on{" "}
          {formatCivilDate(change.from.date)}
        </p>
      )}
    </li>
  );
}
