"use client";

import { useState } from "react";
import { AlertCircle, Dumbbell, Loader2, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatSetLine, groupSetsByExercise } from "@/lib/workouts";
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
 * A "use client" island imported STATICALLY by WorkoutCard. next/dynamic with
 * `ssr: false` was tried for the hydration race described in WorkoutCard's own
 * note and did not fix it, so it is not used here — don't reintroduce it
 * without reproducing that race first.
 */
export function WorkoutTodayPanel() {
  const { data: todaySets, isLoading, isError } = useTodaysSets();
  const { data: sessionCount } = useSessionCount();
  const [editingId, setEditingId] = useState<string | null>(null);

  const groups = groupSetsByExercise(todaySets ?? []);

  return (
    <>
      <div className="mt-3.5">
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-4 w-24 animate-pulse rounded bg-surface-raised" />
            <div className="h-8 animate-pulse rounded-lg bg-surface-raised" />
          </div>
        ) : isError ? (
          <EmptyState
            icon={AlertCircle}
            title="Couldn't load today's sets"
            description="Logging still works."
            density="compact"
          />
        ) : groups.length === 0 ? (
          // One line, not the full EmptyState card. This sits on the first
          // screen above Due Today, where a 100px dashed card costs more than
          // the message is worth. The error branch above keeps the card — it
          // is rare and needs to stop the reader.
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Dumbbell aria-hidden className="h-3.5 w-3.5 shrink-0" />
            Nothing logged today — type a set above and it saves straight away.
          </p>
        ) : (
          <ul className="space-y-3">
            {groups.map((group) => (
              <li key={group.exercise ?? "__unparsed"}>
                <MonoLabel>{group.exercise ?? "Not read yet"}</MonoLabel>
                <ul className="mt-1.5 space-y-1.5">
                  {group.sets.map((set) =>
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
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The feature measuring its own use. Hidden until there is something to
          report, so a brand-new user isn't greeted by a zero. */}
      {(sessionCount ?? 0) > 0 && (
        <p className="mt-3.5 border-t border-border pt-3 font-mono text-xs tabular-nums text-muted-foreground">
          {sessionCount} session{sessionCount === 1 ? "" : "s"} in the last 21
          days
        </p>
      )}
    </>
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
          "flex w-full items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-left transition-colors",
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
    <li className="rounded-lg border border-accent/30 bg-surface-raised p-2.5">
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
