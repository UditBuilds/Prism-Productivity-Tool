"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { ArrowLeft, Check, Loader2, Minus, Plus, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  buildExerciseSections,
  isNovelExerciseName,
} from "@/lib/exercise-library";
import {
  formatSetLine,
  lastSetForExercise,
  type StructuredSetInput,
} from "@/lib/workouts";
import { useLogWorkout, useWorkoutsQuery } from "@/hooks/useWorkouts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MonoLabel } from "@/components/shared/MonoLabel";

/**
 * Stepper increment for weight. 2.5 kg is the smallest plate pair on a
 * standard barbell, so it is the jump the buttons should make. Anything the
 * buttons can't reach (a 12 kg dumbbell, a 1.25 kg micro-plate) is typed
 * straight into the field, which accepts any number.
 */
const WEIGHT_STEP = 2.5;

/** Matches MAX_STRUCTURED_SETS in app/api/workouts/route.ts. */
const MAX_SETS_PER_CAPTURE = 50;

/**
 * The structured logging path: pick an exercise, tap in weight and reps, log.
 *
 * Lives in a sheet rather than inline on the dashboard card because the card
 * sits on the first screen and the builder is ~300px of controls. One tap to
 * open is the cost; the friction this removes is composing a whole sentence.
 *
 * Two steps, one at a time — picker OR builder, never both. At 375px a
 * combobox that keeps its list open above the steppers leaves neither enough
 * room to be tapped comfortably.
 */
export function WorkoutLogSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [exercise, setExercise] = useState<string | null>(null);

  function close() {
    onOpenChange(false);
    // Reset AFTER the close animation so the sheet doesn't visibly snap back
    // to the picker on its way out.
    window.setTimeout(() => setExercise(null), 200);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {exercise === null ? "Pick an exercise" : "Log sets"}
          </DialogTitle>
        </DialogHeader>

        {exercise === null ? (
          <ExercisePicker onPick={setExercise} />
        ) : (
          <SetBuilder
            exercise={exercise}
            onBack={() => setExercise(null)}
            onLogged={close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Searchable list: the user's own recent exercises first, then the static
 * library by body part. Typing filters both; a name that matches nothing can
 * still be used verbatim, which is what keeps the library from being a
 * ceiling — anything logged once is in "Recent" from then on.
 */
function ExercisePicker({ onPick }: { onPick: (exercise: string) => void }) {
  const { data: sets } = useWorkoutsQuery();
  const [query, setQuery] = useState("");

  const sections = useMemo(
    () => buildExerciseSections(sets ?? [], query),
    [sets, query]
  );
  const novel = isNovelExerciseName(sections, query);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exercises"
          aria-label="Search exercises"
          enterKeyHint="search"
          className="h-9 rounded-md pl-9 text-sm"
        />
      </div>

      {/* Bounded so the sheet's own height doesn't swing between a 3-name
          filtered list and the full 70-name library. */}
      <div className="-mx-1 max-h-[45vh] overflow-y-auto px-1">
        {novel && (
          <button
            type="button"
            onClick={() => onPick(query.trim())}
            className="mb-4 flex w-full items-center gap-2 rounded-md border border-accent/30 bg-surface-raised p-4 text-left transition-colors hover:border-accent/60"
          >
            <Plus aria-hidden className="h-4 w-4 shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              Use &ldquo;{query.trim()}&rdquo;
            </span>
          </button>
        )}

        {sections.length === 0 && !novel ? (
          <p className="py-4 text-sm text-muted-foreground">
            No exercises match that.
          </p>
        ) : (
          <ul className="space-y-4">
            {sections.map((section) => (
              <li key={section.heading}>
                <MonoLabel>{section.heading}</MonoLabel>
                <ul className="mt-2 space-y-2">
                  {section.options.map((option) => (
                    <li key={option.key}>
                      <button
                        type="button"
                        onClick={() => onPick(option.name)}
                        className="w-full truncate rounded-md border border-transparent bg-surface-raised p-4 text-left text-sm text-foreground transition-colors hover:border-accent/25 hover:bg-surface-raised/70"
                      >
                        {option.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Blank means "not recorded", which is a real answer for both fields — a set
 * with no weight is bodyweight, a set with no reps is a hold or a to-failure
 * set. 0 collapses to the same thing rather than storing a zero load, matching
 * both parseWorkoutInput and the route's own validation.
 */
function toNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function SetBuilder({
  exercise,
  onBack,
  onLogged,
}: {
  exercise: string;
  onBack: () => void;
  onLogged: () => void;
}) {
  const { data: allSets } = useWorkoutsQuery();
  const logWorkout = useLogWorkout();

  /** That exercise's most recent set across the 21-day window, if any. */
  const previous = useMemo(
    () => lastSetForExercise(allSets ?? [], exercise),
    [allSets, exercise]
  );

  // Prefilled from history so the common case — same load as last time — is
  // zero taps before "Add set".
  const [weight, setWeight] = useState(
    previous?.weight_kg == null ? "" : String(previous.weight_kg)
  );
  const [reps, setReps] = useState(
    previous?.reps == null ? "" : String(previous.reps)
  );
  const [draft, setDraft] = useState<StructuredSetInput[]>([]);

  const current: StructuredSetInput = {
    exercise,
    weight_kg: toNumberOrNull(weight),
    reps: toNumberOrNull(reps),
  };

  /**
   * What "Log" will actually submit. An empty draft submits the steppers as a
   * single set — and the button's own label carries the count, so that rule is
   * visible rather than hidden.
   */
  const pending = draft.length > 0 ? draft : [current];
  const atCap = draft.length >= MAX_SETS_PER_CAPTURE;

  /**
   * "Same as last set" source: the last set added in this sheet if there is
   * one, otherwise the most recent set in history. Both are literally this
   * exercise's most recent set — the draft one is just more recent still.
   */
  const lastAdded = draft.length > 0 ? draft[draft.length - 1] : null;
  const repeatable: StructuredSetInput | null =
    lastAdded ??
    (previous
      ? { exercise, weight_kg: previous.weight_kg, reps: previous.reps }
      : null);

  function applyRepeat() {
    if (!repeatable) return;
    setWeight(repeatable.weight_kg === null ? "" : String(repeatable.weight_kg));
    setReps(repeatable.reps === null ? "" : String(repeatable.reps));
  }

  // Values stay in the fields after adding, so three taps of "Add set" logs
  // three identical sets — the single most common pattern in a real session.
  function addSet() {
    if (atCap) return;
    setDraft((prev) => prev.concat(current));
  }

  function submit() {
    if (logWorkout.isPending) return;
    logWorkout.mutate({
      sets: pending,
      // Stamped here so a capture queued offline keeps the time it was logged,
      // not the time it eventually synced.
      performed_at: new Date().toISOString(),
    });
    onLogged();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onBack}
          className="h-8 shrink-0 rounded-md px-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="h-4 w-4" />
          <span className="sr-only">Change exercise</span>
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {exercise}
        </p>
      </div>

      {previous && (
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          Last time: {formatSetLine(previous)}
        </p>
      )}

      <div className="flex items-start gap-2">
        <Stepper
          label="Weight (kg)"
          value={weight}
          onChange={setWeight}
          step={WEIGHT_STEP}
          decimal
          emptyHint="Bodyweight"
        />
        <Stepper
          label="Reps"
          value={reps}
          onChange={setReps}
          step={1}
          emptyHint="Not recorded"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={addSet}
          disabled={atCap}
          className="h-9 flex-1 rounded-md"
        >
          <Plus aria-hidden className="h-4 w-4" />
          Add set
        </Button>
        {repeatable && (
          <Button
            type="button"
            variant="ghost"
            onClick={applyRepeat}
            className="h-9 shrink-0 rounded-md text-muted-foreground hover:text-foreground"
          >
            Same as last set
          </Button>
        )}
      </div>

      {draft.length > 0 && (
        <div>
          <MonoLabel>
            {draft.length} set{draft.length === 1 ? "" : "s"} ready
          </MonoLabel>
          <ul className="mt-2 space-y-2">
            {draft.map((set, i) => (
              <li
                // Index is a legitimate key here: identical sets are the norm,
                // the list is append/remove-only, and nothing in a row holds
                // its own state.
                key={i}
                className="flex items-center gap-2 rounded-md bg-surface-raised p-4"
              >
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-sm tabular-nums text-foreground">
                  {formatSetLine(set)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setDraft((prev) => prev.filter((_, j) => j !== i))
                  }
                  aria-label={`Remove set ${i + 1}`}
                  className="shrink-0 rounded-md text-muted-foreground transition-colors hover:text-danger"
                >
                  <X aria-hidden className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {atCap && (
        <p className="text-xs text-warning">
          That&rsquo;s {MAX_SETS_PER_CAPTURE} sets — log these, then start
          another.
        </p>
      )}

      <Button
        type="button"
        onClick={submit}
        disabled={logWorkout.isPending}
        className="h-9 w-full rounded-md"
      >
        {logWorkout.isPending ? (
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
        ) : (
          <Check aria-hidden className="h-4 w-4" />
        )}
        Log {pending.length} set{pending.length === 1 ? "" : "s"}
      </Button>
    </div>
  );
}

/**
 * Number field with −/+ buttons either side. The field itself takes any
 * number, so the step only governs the buttons; decrementing to or below zero
 * clears it, because zero weight and no weight are the same fact and
 * "Bodyweight" is the one that reads true.
 *
 * `onChange` is the state SETTER, not a plain callback, so nudge() can apply a
 * functional update. That is load-bearing: React batches the renders from a
 * fast run of taps, so a version reading the `value` prop computes every step
 * in the burst from the same stale string — measured, five quick taps on "+"
 * advanced one step. Getting from 20 kg to 60 kg is a run of taps, so this is
 * the normal case for this control rather than an edge one.
 */
function Stepper({
  label,
  value,
  onChange,
  step,
  decimal = false,
  emptyHint,
}: {
  label: string;
  value: string;
  onChange: Dispatch<SetStateAction<string>>;
  step: number;
  decimal?: boolean;
  emptyHint: string;
}) {
  function nudge(delta: number) {
    onChange((prev) => {
      const numeric = Number(prev.trim());
      const current =
        prev.trim() === "" || !Number.isFinite(numeric) ? 0 : numeric;
      const next = current + delta;
      if (next <= 0) return "";
      // Rounded to 2dp so repeated 2.5 steps off a typed 0.1 can't drift into
      // float noise the numeric column would then store.
      return String(Math.round(next * 100) / 100);
    });
  }

  return (
    <div className="min-w-0 flex-1">
      <MonoLabel>{label}</MonoLabel>
      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={() => nudge(-step)}
          aria-label={`Decrease ${label}`}
          className="h-9 w-9 shrink-0 rounded-md"
        >
          <Minus aria-hidden className="h-4 w-4" />
        </Button>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          type="number"
          inputMode={decimal ? "decimal" : "numeric"}
          min={0}
          step={decimal ? "0.5" : "1"}
          placeholder="—"
          className={cn(
            "h-9 min-w-0 rounded-md text-center font-mono text-sm tabular-nums",
            // Native spinners would sit next to the −/+ buttons doing the same
            // job at a third the tap target.
            "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          )}
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={() => nudge(step)}
          aria-label={`Increase ${label}`}
          className="h-9 w-9 shrink-0 rounded-md"
        >
          <Plus aria-hidden className="h-4 w-4" />
        </Button>
      </div>
      {value.trim() === "" && (
        <p className="mt-2 text-xs text-muted-foreground">{emptyHint}</p>
      )}
    </div>
  );
}
