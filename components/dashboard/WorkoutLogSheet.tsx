"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { ArrowLeft, Check, Loader2, Minus, Plus, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  buildExerciseSections,
  isNovelExerciseName,
  resolveExerciseName,
} from "@/lib/exercise-library";
import {
  formatSetLine,
  groupStructuredSets,
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
 * Structured logging: build a whole session locally, then save it in ONE
 * request.
 *
 * WHY BATCHED. Logging per exercise made each entry fast but turned a real
 * 8-12 exercise session into 8-12 round trips, which is its own kind of
 * lengthy. The endpoint already reads `exercise` per set rather than per
 * capture, so a session is one payload and needed no server change.
 *
 * Three views, one at a time — at 375px a combobox that keeps its list open
 * above the steppers leaves neither enough room to be tapped comfortably:
 *   session -> what's been added so far, and the one Save action
 *   picker  -> choose the next exercise
 *   builder -> weight/reps for that exercise, added to the session draft
 *
 * The draft lives in WorkoutCard, NOT here, so closing the sheet mid-session
 * doesn't discard eight exercises of work — only a successful save or an
 * explicit Clear empties it.
 */
export function WorkoutLogSheet({
  open,
  onOpenChange,
  session,
  setSession,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: StructuredSetInput[];
  setSession: Dispatch<SetStateAction<StructuredSetInput[]>>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <SheetBody
          session={session}
          setSession={setSession}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

type View = "session" | "picker" | "builder";

function SheetBody({
  session,
  setSession,
  onClose,
}: {
  session: StructuredSetInput[];
  setSession: Dispatch<SetStateAction<StructuredSetInput[]>>;
  onClose: () => void;
}) {
  const logWorkout = useLogWorkout();
  // Opening onto a session in progress shows it; opening fresh skips straight
  // to picking, so the empty case costs no extra tap.
  const [view, setView] = useState<View>(session.length ? "session" : "picker");
  const [exercise, setExercise] = useState<string | null>(null);

  /**
   * An empty session has nothing to show, so fall through to the picker.
   *
   * DERIVED rather than a state reset because this component is NOT reliably
   * remounted between opens: Radix keeps content mounted for the duration of
   * the exit animation, so a close-and-reopen inside that window — or any
   * environment where the animation never completes — reuses this state. After
   * a save (which empties the draft) that left the sheet showing "Nothing in
   * this session yet" above a disabled "Save session (0 sets)". A guard cannot
   * fall out of sync the way a reset can.
   */
  const effectiveView: View =
    view === "session" && session.length === 0 ? "picker" : view;

  const remaining = MAX_SETS_PER_CAPTURE - session.length;

  function addToSession(sets: StructuredSetInput[]) {
    setSession((prev) => prev.concat(sets));
    setExercise(null);
    setView("session");
  }

  function save() {
    if (logWorkout.isPending || session.length === 0) return;
    logWorkout.mutate({
      sets: session,
      // Stamped here so a session queued offline keeps the time it was logged,
      // not the time it eventually synced.
      performed_at: new Date().toISOString(),
    });
    setSession([]);
    onClose();
  }

  if (effectiveView === "builder" && exercise !== null) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Add sets</DialogTitle>
        </DialogHeader>
        <SetBuilder
          exercise={exercise}
          session={session}
          remaining={remaining}
          onBack={() => {
            setExercise(null);
            setView(session.length ? "session" : "picker");
          }}
          onAdd={addToSession}
        />
      </>
    );
  }

  if (effectiveView === "picker") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Pick an exercise</DialogTitle>
        </DialogHeader>
        <ExercisePicker
          showBack={session.length > 0}
          onBack={() => setView("session")}
          onPick={(name) => {
            setExercise(name);
            setView("builder");
          }}
        />
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Session</DialogTitle>
      </DialogHeader>
      <SessionDraft
        session={session}
        setSession={setSession}
        remaining={remaining}
        saving={logWorkout.isPending}
        onAddExercise={() => setView("picker")}
        onSave={save}
      />
    </>
  );
}

/**
 * The in-progress session: every exercise added so far, and the Save action.
 * Only rendered with at least one set — SheetBody's effectiveView sends an
 * empty session to the picker instead.
 */
function SessionDraft({
  session,
  setSession,
  remaining,
  saving,
  onAddExercise,
  onSave,
}: {
  session: StructuredSetInput[];
  setSession: Dispatch<SetStateAction<StructuredSetInput[]>>;
  remaining: number;
  saving: boolean;
  onAddExercise: () => void;
  onSave: () => void;
}) {
  const groups = groupStructuredSets(session);

  function removeAt(index: number) {
    setSession((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 16 between exercise groups, 8 from a group's label to its sets and
          between the sets — the dashboard's own spacing scale. */}
      <ul className="max-h-[45vh] space-y-4 overflow-y-auto">
        {groups.map((group) => (
          <li key={group.exercise}>
            <MonoLabel>{group.exercise}</MonoLabel>
            <ul className="mt-2 space-y-2">
              {group.sets.map(({ set, index }, i) => (
                <li
                  key={index}
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
                    onClick={() => removeAt(index)}
                    aria-label={`Remove ${group.exercise} set ${i + 1}`}
                    className="shrink-0 rounded-md text-muted-foreground transition-colors hover:text-danger"
                  >
                    <X aria-hidden className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {remaining <= 0 && (
        <p className="text-xs text-warning">
          That&rsquo;s {MAX_SETS_PER_CAPTURE} sets — save this session, then
          start another.
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onAddExercise}
          disabled={remaining <= 0}
          className="h-9 flex-1 rounded-md"
        >
          <Plus aria-hidden className="h-4 w-4" />
          Add exercise
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setSession([])}
          className="h-9 shrink-0 rounded-md text-muted-foreground hover:text-danger"
        >
          Clear
        </Button>
      </div>

      <Button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="h-9 w-full rounded-md"
      >
        {saving ? (
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
        ) : (
          <Check aria-hidden className="h-4 w-4" />
        )}
        Save session ({session.length} set{session.length === 1 ? "" : "s"})
      </Button>
    </div>
  );
}

/**
 * Searchable list: the user's own recent exercises first, then the static
 * library by body part. Typing filters both; a name that matches nothing can
 * still be added, which is what keeps the library from being a ceiling.
 *
 * A typed name is resolved BEFORE it is picked, so "bench  PRESS" logs the
 * existing "Bench Press" instead of a second spelling of it, and a genuinely
 * new name is Title Cased on the way in — see resolveExerciseName.
 */
function ExercisePicker({
  showBack,
  onBack,
  onPick,
}: {
  showBack: boolean;
  onBack: () => void;
  onPick: (exercise: string) => void;
}) {
  const { data: sets } = useWorkoutsQuery();
  const [query, setQuery] = useState("");

  const history = useMemo(() => sets ?? [], [sets]);
  const sections = useMemo(
    () => buildExerciseSections(history, query),
    [history, query]
  );
  const novel = isNovelExerciseName(history, query);
  // What the freeform entry would actually store — shown on the button so the
  // normalisation is visible before it is accepted, not a surprise after.
  const novelName = novel ? resolveExerciseName(history, query).name : "";

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex items-center gap-2">
        {showBack && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onBack}
            className="h-9 shrink-0 rounded-md px-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft aria-hidden className="h-4 w-4" />
            <span className="sr-only">Back to session</span>
          </Button>
        )}
        <div className="relative min-w-0 flex-1">
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
      </div>

      {/* Bounded so the sheet's own height doesn't swing between a 3-name
          filtered list and the full 66-name library. */}
      <div className="-mx-1 max-h-[45vh] overflow-y-auto px-1">
        {novel && (
          <button
            type="button"
            onClick={() => onPick(novelName)}
            className="mb-4 flex w-full items-center gap-2 rounded-md border border-accent/30 bg-surface-raised p-4 text-left transition-colors hover:border-accent/60"
          >
            <Plus aria-hidden className="h-4 w-4 shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              Add &ldquo;{novelName}&rdquo;
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
  session,
  remaining,
  onBack,
  onAdd,
}: {
  exercise: string;
  session: StructuredSetInput[];
  remaining: number;
  onBack: () => void;
  onAdd: (sets: StructuredSetInput[]) => void;
}) {
  const { data: allSets } = useWorkoutsQuery();

  /**
   * What to prefill from. Sets already added to THIS session win over stored
   * history — they are literally this exercise's most recent sets — and the
   * label says which, so "Last time" never claims a number from ten minutes
   * ago was from last week.
   */
  const previous = useMemo(() => {
    for (let i = session.length - 1; i >= 0; i--) {
      if (session[i].exercise === exercise) {
        return { set: session[i], source: "session" as const };
      }
    }
    const stored = lastSetForExercise(allSets ?? [], exercise);
    return stored ? { set: stored, source: "history" as const } : null;
  }, [session, exercise, allSets]);

  const [weight, setWeight] = useState(
    previous?.set.weight_kg == null ? "" : String(previous.set.weight_kg)
  );
  const [reps, setReps] = useState(
    previous?.set.reps == null ? "" : String(previous.set.reps)
  );
  const [draft, setDraft] = useState<StructuredSetInput[]>([]);

  const current: StructuredSetInput = {
    exercise,
    weight_kg: toNumberOrNull(weight),
    reps: toNumberOrNull(reps),
  };

  /**
   * What "Add" will hand to the session. An empty draft contributes the
   * steppers as a single set — and the button's own label carries the count,
   * so that rule is visible rather than hidden.
   */
  const pending = draft.length > 0 ? draft : [current];
  const atCap = draft.length >= remaining;

  /**
   * "Same as last set" source: the last set added here if there is one,
   * otherwise whatever `previous` resolved to. Both are this exercise's most
   * recent set — the draft one is just more recent still.
   */
  const repeatable: StructuredSetInput | null =
    draft.length > 0
      ? draft[draft.length - 1]
      : previous
        ? {
            // `previous.set` may be a stored row, whose exercise is nullable —
            // the picked name is the authoritative one either way.
            exercise,
            weight_kg: previous.set.weight_kg,
            reps: previous.set.reps,
          }
        : null;

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
          <span className="sr-only">Back</span>
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {exercise}
        </p>
      </div>

      {previous && (
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          {previous.source === "session" ? "This session" : "Last time"}:{" "}
          {formatSetLine(previous.set)}
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
          This session is at the {MAX_SETS_PER_CAPTURE}-set limit — save it,
          then start another.
        </p>
      )}

      <Button
        type="button"
        onClick={() => onAdd(pending)}
        disabled={pending.length > remaining}
        className="h-9 w-full rounded-md"
      >
        <Plus aria-hidden className="h-4 w-4" />
        Add {pending.length} set{pending.length === 1 ? "" : "s"} to session
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
