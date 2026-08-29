"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  Dumbbell,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  formatChange,
  formatCivilDate,
  formatDaysSince,
  formatSessionTopSet,
  type BodyPartLoad,
  type ExerciseProgression,
} from "@/lib/workout-analysis";
import { UNCLASSIFIED_BODY_PART } from "@/lib/exercise-library";
import { useWorkoutAnalysis } from "@/hooks/useWorkoutAnalysis";
import { EmptyState } from "@/components/shared/EmptyState";

/**
 * Progressive overload AND body-part balance, in one grouped, collapsible
 * view. This section replaced two — the flat per-exercise list and the
 * standalone Balance panel, which is deleted.
 *
 * WHY THE TWO MERGED. Flat, Progress was one row per distinct exercise with no
 * cap: 13 rows and 1239px on the real table, and it had gone 4 -> 5 -> 9 -> 13
 * over four sessions. Balance sat directly beneath restating the same sets
 * from the other direction, at another 548px. Together they were 71.5% of a
 * page 3+ screens tall, and the two things a user comes here to DO (log a set,
 * see today) were 14%. Balance's per-part facts are exactly the summary a
 * progression group's header wants, so folding one into the other removes a
 * whole section rather than shortening it.
 *
 * GROUPING IS CLIENT-SIDE, DELIBERATELY. The endpoint already returns
 * everything this needs — `progressions[]` each carrying its own `bodyPart`,
 * and `bodyParts[]` carrying every group including the zeros, pre-sorted, with
 * daysSince and set counts. Grouping here is a pure regrouping of data already
 * in hand. Doing it server-side would change the shape of a PERSISTED cache
 * (["workout-analysis"] is dehydrated to IndexedDB), which needs a buster bump
 * and breaks in-flight snapshots, to solve a presentation problem. The brief
 * for this change also draws the line there: the data and queries behind these
 * two views are not being changed, only their container.
 *
 * ORDER IS MOST-RECENTLY-TRAINED FIRST, AND THAT INVERTS BALANCE'S OWN
 * RANKING — flagged for review. `bodyParts` arrives sorted most-neglected
 * first, which is the ranking that panel was named for, and the UI was told
 * not to re-sort it. That ordering is right for a section whose subject is
 * neglect; it is wrong for one whose subject is progression, because it puts
 * two empty groups above everything the user actually did and leaves the one
 * open group at the bottom of the section. Recency-first here, zeros last,
 * still visible.
 */
export function WorkoutProgressPanel() {
  const { data, isLoading, isError } = useWorkoutAnalysis();

  const groups = useMemo(
    () => buildGroups(data?.bodyParts ?? [], data?.progressions ?? []),
    [data]
  );

  /**
   * Which groups the user has toggled, as an override map over the default.
   * An override rather than seeded state: the default depends on `data`, which
   * arrives asynchronously, and seeding from it would need an effect that then
   * fights every refetch.
   */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

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
  const windowDays = data?.windowDays ?? 0;
  // The default: only the first group carrying work is open. Everything else,
  // including every untrained group, starts closed.
  const defaultOpen = groups.find((g) => g.rows.length > 0)?.part.bodyPart;

  return (
    <>
      {comparable === 0 && (
        // Unchanged from the flat version, and still stated ONCE at section
        // level rather than per row. With this many baselines a per-row
        // "first session" would print the same sentence a dozen times and
        // drown the numbers that differ.
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          No exercise logged twice yet — these are your starting points. Repeat
          one and its change appears here.
        </p>
      )}

      <ul className="space-y-2">
        {groups.map((group) => (
          <BodyPartGroup
            key={group.part.bodyPart}
            group={group}
            windowDays={windowDays}
            open={
              overrides[group.part.bodyPart] ??
              group.part.bodyPart === defaultOpen
            }
            onToggle={() =>
              setOverrides((prev) => ({
                ...prev,
                [group.part.bodyPart]:
                  !(prev[group.part.bodyPart] ??
                  group.part.bodyPart === defaultOpen),
              }))
            }
          />
        ))}
      </ul>
    </>
  );
}

interface Group {
  part: BodyPartLoad;
  rows: ExerciseProgression[];
}

/**
 * Join the two arrays the endpoint already returns.
 *
 * `bodyPart` is nullable on a progression (the library doesn't know the name),
 * and `analyseWorkoutSets` counts those same sets under UNCLASSIFIED_BODY_PART
 * in `bodyParts`. Resolving null the same way here is what keeps the two
 * halves agreeing — the real table's "Hacksquat" is exactly this case, and it
 * must land in the same "Other" group its sets were counted in.
 */
function buildGroups(
  bodyParts: BodyPartLoad[],
  progressions: ExerciseProgression[]
): Group[] {
  const byPart: Record<string, ExerciseProgression[]> = {};
  for (const p of progressions) {
    const part = p.bodyPart ?? UNCLASSIFIED_BODY_PART;
    (byPart[part] ??= []).push(p);
  }

  return bodyParts
    .map((part) => ({ part, rows: byPart[part.bodyPart] ?? [] }))
    .sort((a, b) => {
      // Trained before untrained, then most recently trained first. The
      // progressions inside each group keep the endpoint's own ordering
      // (comparable-first, then recency), which is not re-sorted here.
      const aT = a.part.lastTrained;
      const bT = b.part.lastTrained;
      if (aT === null || bT === null) {
        if (aT === bT) return 0;
        return aT === null ? 1 : -1;
      }
      return aT < bT ? 1 : aT > bT ? -1 : 0;
    });
}

function BodyPartGroup({
  group,
  windowDays,
  open,
  onToggle,
}: {
  group: Group;
  windowDays: number;
  open: boolean;
  onToggle: () => void;
}) {
  const { part, rows } = group;
  const untrained = part.sets === 0;

  const summary = untrained
    ? // Scoped to the window, NOT "Never trained" — carried over verbatim from
      // the Balance panel this replaced. The analysis reads 180 days; a group
      // last trained 200 days ago is invisible to it, and asserting "never"
      // would state as fact something it cannot see.
      `Nothing in the last ${windowDays} days`
    : `${part.sets} set${part.sets === 1 ? "" : "s"} · last trained ${formatDaysSince(
        part.daysSince ?? 0
      )}`;

  /**
   * An untrained group has nothing to expand, so it is a static row rather
   * than a dead button — a control that visibly does nothing is worse than no
   * control. It still occupies a full row and still states its own zero, which
   * is the whole reason empty groups are kept.
   */
  if (untrained) {
    return (
      <li className="rounded-md border border-transparent bg-surface-raised px-4 py-3">
        <GroupHeading part={part} summary={summary} untrained />
      </li>
    );
  }

  return (
    <li className="rounded-md border border-transparent bg-surface-raised">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md px-4 py-3 text-left transition-colors hover:bg-surface-raised/70"
      >
        <GroupHeading part={part} summary={summary} />
        <ChevronDown
          aria-hidden
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        // 8 between rows, and the list carries the 16 inset itself so the
        // rows line up under the header's text rather than under its edge.
        <ul className="space-y-2 px-4 pb-4">
          {rows.map((p) => (
            <ProgressRow key={p.key} progression={p} />
          ))}
        </ul>
      )}
    </li>
  );
}

function GroupHeading({
  part,
  summary,
  untrained = false,
}: {
  part: BodyPartLoad;
  summary: string;
  untrained?: boolean;
}) {
  return (
    <span className="min-w-0 flex-1">
      <span
        className={cn(
          "block truncate font-mono text-xs font-medium uppercase tracking-[0.1em]",
          untrained ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {part.bodyPart}
      </span>
      {/* 8 inside one object — the group's label to its own summary. */}
      <span className="mt-2 block truncate font-mono text-xs tabular-nums text-muted-foreground">
        {summary}
      </span>
    </span>
  );
}

/**
 * One exercise. UNCHANGED from the flat version except that it now sits inside
 * a group, so the body part is dropped from its meta line — the group heading
 * two lines above already says it, and repeating it on every row was the most
 * duplicated string on the page.
 */
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
    <li className="rounded-md border border-border bg-surface p-4">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {progression.exercise}
        </span>
        <span className="shrink-0 font-mono text-sm tabular-nums text-foreground">
          {formatSessionTopSet(latest)}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
          {formatCivilDate(latest.date)}
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
