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
 * Training drift: what each body part is owed, and whether the weight is
 * moving.
 *
 * It states each of those ONCE. The panel used to open with "Last session
 * <date> · N sessions in 180 days" and close with "N groups untrained in
 * 180d", and both were restatements — the date of the last session is on the
 * progression rows, which each end in their own date, and the untrained count
 * is the number of body-part cells that say so. Two lines of summary wrapped
 * around two lists that already said it.
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
      <SectionPanel title="Training" variant="block">
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
      <SectionPanel title="Training" variant="block">
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

  /**
   * Trained groups first, untrained after — NOT the endpoint's own order.
   *
   * `analyseWorkoutSets` sorts most-neglected-first, which is right for the
   * workout page's ranking but wrong for a grid: the two groups with nothing
   * behind them would take the top-left cells, and the emptier the history the
   * louder the section would get. Each half keeps the endpoint's ordering
   * inside itself (longest-untrained, then least work), so the ranking is
   * intact within the part of the list that has anything to rank.
   *
   * Same rule the workout page's grouped Progress section applies, and the
   * same reading order this panel already had when the trained groups were
   * chips and the rest were a summary line.
   */
  const ordered = [
    ...data.bodyParts.filter((b) => b.daysSince !== null),
    ...data.bodyParts.filter((b) => b.daysSince === null),
  ];

  return (
    <SectionPanel
      title="Training"
      href="/dashboard/workout"
      linkLabel="View all"
      variant="block"
    >
      {/* The two sub-sections, 16 apart, carried by the wrapper rather than a
          `mt-4` on each. The "Last session" line that used to sit first is
          gone, and with it the child that those top margins were measured
          from — a leading `mt-4` would now add a second 16 on top of the
          block's own p-4 and read as a void above the first label. */}
      <div className="space-y-4">
        {progressing.length > 0 && (
          <div>
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

        {ordered.length > 0 && (
          <div>
            <MonoLabel as="p">Body parts</MonoLabel>

            {/* A GRID, not a wrapped tag list. As inline chips the pairs broke
                wherever the previous label's length happened to leave room, so
                every group started at a different x and the section read as
                looser than the progression rows directly above it — which are
                a column.

                TWO COLUMNS IS THE PHONE-WIDTH CEILING, and the binding
                string is the untrained one. At 375 with default text the cell
                is 146.5 and "Nothing in 180d" needs 108. A third column would
                leave ~93 and not fit it.

                CELLS WRAP, THEY DO NOT TRUNCATE, and that is the whole point
                of this pair of <p>s carrying no `truncate`. They had it, and
                on a real phone with a larger text setting the untrained cells
                rendered "Nothing in 1…" — clipping away the "180d", which is
                the exact thing this wording exists to say. Text scaling makes
                the cell fail from BOTH ends at once: the type grows while the
                cell shrinks, because Tailwind's p-4 and gap-4 are rem-based
                and scale with it. Reproduced at a 1.36x setting (root 22px):
                type 12 -> 16.5px, string 108 -> 148.5px, cell 146.5 -> 131.5.

                So do not reach for `truncate` here again, and do not chase a
                width threshold — there isn't a fixed one. A wrap costs a
                second line in the one cell that needs it; an ellipsis costs
                the information.

                An odd count leaves the last cell alone, deliberately. A filler
                cell would be a body part that does not exist. */}
            <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-4">
              {ordered.map((b) => {
                const untrained = b.daysSince === null;
                return (
                  <li key={b.bodyPart} className="min-w-0">
                    <p
                      className={cn(
                        "break-words text-sm",
                        untrained ? "text-muted-foreground" : "text-foreground"
                      )}
                    >
                      {b.bodyPart}
                    </p>
                    {/* 8 inside one object: the group and its own recency. The
                        gap BETWEEN cells is 16, so the pair reads as a pair. */}
                    <p
                      className={cn(
                        "mt-2 break-words font-mono text-xs tabular-nums",
                        untrained
                          ? "text-muted-foreground/70"
                          : "text-muted-foreground"
                      )}
                    >
                      {untrained
                        ? // Still "nothing in N days", never "never" — the
                          // analysis cannot see past its window, so "never"
                          // would assert what it has no evidence for. This is
                          // where that signal lives now that the "N groups
                          // untrained" summary line is gone: in the cell
                          // itself, next to the group it is about.
                          `Nothing in ${data.windowDays}d`
                        : formatDaysSince(b.daysSince as number)}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </SectionPanel>
  );
}
