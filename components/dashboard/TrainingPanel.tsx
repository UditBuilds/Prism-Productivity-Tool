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
  type ExerciseProgression,
  type ProgressChange,
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
        {/* A word, not a grey block. A pulsing filled bar is a surface, and it
            was the only one that ever appeared in this section. */}
        <p className="animate-pulse font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
          Loading
        </p>
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

  /**
   * ONLY exercises that actually have something to progress FROM.
   *
   * The block shipped rendering the top 3 exercises whatever their state, and
   * since no exercise in the real table has yet been logged on two different
   * days, all three rows read "First session" — the same absence of data stated
   * three times at full fidelity. A progression readout with nothing to
   * progress from is not a readout, so an entry without a prior session is not
   * a quiet row here, it is not a row at all; when none qualify the whole block
   * (heading included) is suppressed.
   *
   * `analyseWorkoutSets` already sorts comparable entries first, so slicing
   * after the filter can never drop a comparable row in favour of a baseline.
   */
  const progressing = data.progressions
    .filter(
      (p): p is ExerciseProgression & { change: ProgressChange } =>
        p.change !== null
    )
    .slice(0, PROGRESSION_LIMIT);

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

      {progressing.length > 0 && (
        <div className="mt-4">
          <MonoLabel as="p">Progression</MonoLabel>
          <ul className="mt-2 divide-y">
            {progressing.map((p) => (
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
                {/* Every row here HAS a change — the baseline case is filtered
                    out above rather than rendered as "First session", so this
                    chip always states a real comparison. */}
                <span
                  className={cn(
                    "shrink-0 font-mono text-xs tabular-nums",
                    DIRECTION_TINT[p.change.direction]
                  )}
                >
                  {formatChange(p.change)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.bodyParts.length > 0 && (
        <div className="mt-4">
          <MonoLabel as="p">Body parts</MonoLabel>

          {/* A chip is spent only on a group with actual work behind it. Six
              chips, four of them saying "nothing in 180d", wrapped to three
              lines and gave the absence of training more room than the
              training — the emptier the history, the louder the section got. */}
          {/* The chips lost their fill. A body part and its staleness are a
              noun and a number, and they read as a pair from the weight
              difference alone — the capsule was doing no work the type wasn't
              already doing. Wrapping is now on a wider gap so the pairs stay
              distinguishable without a box to bound them. */}
          {trained.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {trained.map((b) => (
                <li key={b.bodyPart} className="text-sm text-foreground">
                  {b.bodyPart}{" "}
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatDaysSince(b.daysSince as number).toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* The rest collapse to one line. Still counted, never dropped — and
              still "nothing in N days", never "never": the analysis cannot see
              past its window, so "never" would assert what it has no evidence
              for. Muted, not alarming: an untrained group is information. */}
          {untrained.length > 0 && (
            <p className="mt-2 font-mono text-xs text-muted-foreground/70">
              {untrained.length} group{untrained.length === 1 ? "" : "s"}{" "}
              untrained in {data.windowDays}d
            </p>
          )}
        </div>
      )}
    </SectionPanel>
  );
}
