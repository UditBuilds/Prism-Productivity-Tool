"use client";

import { Fragment, useState } from "react";
import { useIsRestoring } from "@tanstack/react-query";
import { AlertCircle, Dumbbell, Loader2, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  collapseConsecutiveSets,
  formatSetLine,
  groupSetsByExercise,
  type SetRun,
} from "@/lib/workouts";
import {
  useDeleteWorkoutSet,
  useSessionCount,
  useTodaysSets,
  useUpdateWorkoutSet,
} from "@/hooks/useWorkouts";
import type { WorkoutSet } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/EmptyState";
import { MonoLabel } from "@/components/shared/MonoLabel";

/** Optimistic rows carry a client-generated id and no parsed fields yet. */
function isPending(set: WorkoutSet): boolean {
  return set.id.startsWith("optimistic-");
}

/**
 * Today's sets plus the 21-day session count.
 *
 * Imported STATICALLY by the Workout page. next/dynamic with `ssr: false` was
 * tried for the hydration race described in that page's own note and did not
 * fix it, so it is not used here — don't reintroduce it without reproducing
 * that race first.
 */
export function WorkoutTodayPanel() {
  const { data: todaySets, isLoading, isError } = useTodaysSets();
  const { data: sessionCount } = useSessionCount();
  const [editingId, setEditingId] = useState<string | null>(null);
  /**
   * Run keys the user has opened. Expand-only: once a run is open its members
   * are ordinary rows whose tap target is the editor, so there is nothing left
   * to tap to re-collapse and no invented control to do it. Keyed by the run's
   * first set id, which survives a refetch — an unrelated log elsewhere on the
   * page doesn't snap an opened run shut.
   */
  const [expandedRuns, setExpandedRuns] = useState<string[]>([]);

  // Both hooks derive from the ONE persisted ["workouts"] cache, so a single
  // gate covers the set list and the 21-day session count. The snapshot
  // restores from IndexedDB asynchronously and nothing waits for it; isLoading
  // reads false throughout a restore (the query never fetches), so it could
  // never have been the gate. isRestoring is true on the server render and the
  // first client render alike.
  const restoring = useIsRestoring() || isLoading;

  const groups = groupSetsByExercise(todaySets ?? []);

  return (
    <>
      {/* No top margin: this is the first thing in its own section panel, whose
          16 padding already spaces it. On the dashboard card it followed the
          log form and carried the 16 itself. */}
      <div>
        {restoring ? (
          <div className="space-y-2">
            <div className="h-4 w-24 animate-pulse rounded bg-surface-raised" />
            <div className="h-8 animate-pulse rounded-md bg-surface-raised" />
          </div>
        ) : isError ? (
          <EmptyState
            icon={AlertCircle}
            title="Couldn't load today's sets"
            description="Logging still works."
            density="compact"
          />
        ) : groups.length === 0 ? (
          // One line, not the full EmptyState card: the Log panel directly
          // above already says what to do, so a dashed card repeating it in
          // larger type is a second answer to a question nobody asked. The
          // error branch above keeps the card — it is rare and needs to stop
          // the reader.
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Dumbbell aria-hidden className="h-3.5 w-3.5 shrink-0" />
            Nothing logged today — type a set above and it saves straight away.
          </p>
        ) : (
          // 16 between exercise groups (two sub-groups), 8 from a group's
          // label to its sets and between the sets (one object). Was 12 / 6.
          <ul className="space-y-4">
            {groups.map((group) => (
              <li key={group.exercise ?? "__unparsed"}>
                <MonoLabel>{group.exercise ?? "Not read yet"}</MonoLabel>
                <ul className="mt-2 space-y-2">
                  {collapseConsecutiveSets(group.sets).map((run) =>
                    run.sets.length > 1 &&
                    expandedRuns.indexOf(run.key) === -1 ? (
                      <CollapsedRun
                        key={run.key}
                        run={run}
                        onExpand={() =>
                          setExpandedRuns((prev) => prev.concat(run.key))
                        }
                      />
                    ) : (
                      // Expanded (or never collapsed) — the individual rows,
                      // in their stored set_index order.
                      <Fragment key={run.key}>
                        {run.sets.map((set) =>
                          editingId === set.id ? (
                            <SetEditor
                              key={set.id}
                              set={set}
                              onClose={() => setEditingId(null)}
                            />
                          ) : (
                            <SetRow
                              key={set.id}
                              set={set}
                              onEdit={() => setEditingId(set.id)}
                            />
                          )
                        )}
                      </Fragment>
                    )
                  )}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The feature measuring its own use. Hidden until there is something to
          report, so a brand-new user isn't greeted by a zero. */}
      {!restoring && (sessionCount ?? 0) > 0 && (
        <p className="mt-4 border-t border-border pt-4 font-mono text-xs tabular-nums text-muted-foreground">
          {sessionCount} session{sessionCount === 1 ? "" : "s"} in the last 21
          days
        </p>
      )}
    </>
  );
}

/**
 * N identical consecutive sets as one row. Tapping it expands the run in place
 * into its individual rows, each of which opens the existing editor — the
 * correction path stays reachable, one tap deeper.
 *
 * The "×3" badge is the SET count, and everything about it is chosen so it
 * cannot be misread as reps: 12 mono (the meta rank) against the title's 14,
 * muted against the title's foreground, hard right where the title never
 * reaches, and the × LEADS the number where the title's × sits between two
 * ("70 kg × 8"). It is deliberately not a pill — the row is already tier 2, so
 * a surface-raised pill on it would be invisible, and a bordered one would
 * need a padding value that isn't on the 8/16/32 scale.
 */
function CollapsedRun({ run, onExpand }: { run: SetRun; onExpand: () => void }) {
  const count = run.sets.length;
  // Every set in a run is identical by construction, so the first one speaks
  // for all of them.
  const label = formatSetLine(run.sets[0]);

  return (
    <li>
      <button
        type="button"
        onClick={onExpand}
        aria-expanded={false}
        aria-label={`${label}, ${count} sets. Show each set`}
        className="flex w-full items-center gap-2 rounded-md border border-transparent bg-surface-raised p-4 text-left transition-colors hover:border-accent/25 hover:bg-surface-raised/70"
      >
        <Dumbbell
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1 truncate font-mono text-sm tabular-nums text-foreground">
          {label}
        </span>
        <span
          aria-hidden
          className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
        >
          ×{count}
        </span>
      </button>
    </li>
  );
}

function SetRow({ set, onEdit }: { set: WorkoutSet; onEdit: () => void }) {
  const pending = isPending(set);
  // An unparsed row shows what was typed — the only thing it reliably has.
  const label = set.exercise === null ? set.raw_input : formatSetLine(set);

  return (
    <li>
      <button
        type="button"
        onClick={onEdit}
        disabled={pending}
        className={cn(
          // Tier 2 inside the Workout panel — same treatment as a dashboard
          // row: surface-raised, transparent border reserved for hover, 16
          // padding, nested radius.
          "flex w-full items-center gap-2 rounded-md border border-transparent bg-surface-raised p-4 text-left transition-colors",
          pending
            ? "cursor-default opacity-60"
            : "hover:border-accent/25 hover:bg-surface-raised/70"
        )}
      >
        <Dumbbell
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-mono text-sm tabular-nums",
            set.exercise === null ? "text-muted-foreground" : "text-foreground"
          )}
        >
          {label}
        </span>
        {pending && (
          <Loader2
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
          />
        )}
      </button>
    </li>
  );
}

/** Compact inline editor: exercise, weight, reps, plus delete. */
function SetEditor({ set, onClose }: { set: WorkoutSet; onClose: () => void }) {
  const updateSet = useUpdateWorkoutSet();
  const deleteSet = useDeleteWorkoutSet();

  const [exercise, setExercise] = useState(set.exercise ?? "");
  const [weight, setWeight] = useState(
    set.weight_kg === null ? "" : String(set.weight_kg)
  );
  const [reps, setReps] = useState(set.reps === null ? "" : String(set.reps));

  // Blank clears the field; anything unparseable keeps the stored value rather
  // than silently nulling a number the user didn't mean to touch.
  function numberOrNull(value: string, fallback: number | null): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  function save() {
    const parsedReps = numberOrNull(reps, set.reps);
    updateSet.mutate({
      id: set.id,
      exercise: exercise.trim() || null,
      weight_kg: numberOrNull(weight, set.weight_kg),
      reps: parsedReps === null ? null : Math.round(parsedReps),
    });
    onClose();
  }

  return (
    <li className="rounded-md border border-accent/30 bg-surface-raised p-4">
      <Input
        value={exercise}
        onChange={(e) => setExercise(e.target.value)}
        placeholder="Exercise"
        aria-label="Exercise"
        className="h-8 rounded-md text-sm"
      />
      <div className="mt-2 flex items-center gap-2">
        <Input
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder="kg"
          aria-label="Weight in kilograms"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.5"
          className="h-8 rounded-md text-sm"
        />
        <span aria-hidden className="text-xs text-muted-foreground">
          ×
        </span>
        <Input
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          placeholder="reps"
          aria-label="Reps"
          type="number"
          inputMode="numeric"
          min={0}
          step="1"
          className="h-8 rounded-md text-sm"
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" onClick={save} className="h-8 flex-1 rounded-md">
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="h-8 rounded-md text-muted-foreground hover:text-foreground"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            deleteSet.mutate(set.id);
            onClose();
          }}
          aria-label="Delete set"
          className="h-8 rounded-md text-muted-foreground hover:text-danger"
        >
          <Trash2 aria-hidden className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}
