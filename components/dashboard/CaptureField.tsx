"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { hapticTap } from "@/lib/haptics";
import {
  CAPTURE_DESTINATION_LABEL,
  routeCapture,
  type CaptureDestination,
} from "@/lib/capture";
import {
  isBackdated,
  workoutDateShortLabel,
  workoutPerformedAtIso,
  workoutToday,
} from "@/lib/workouts";
import { REFRESH_SERVER_DATA } from "@/lib/rsc-refresh";
import { BLOCK_SURFACE } from "@/components/dashboard/SectionPanel";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCreateTask } from "@/hooks/useTasks";
import { useCreateNote } from "@/hooks/useNotes";
import { useLogWorkout } from "@/hooks/useWorkouts";

/** How long the "added to X" confirmation stays up. */
const CONFIRM_MS = 2600;

/**
 * The prefix syntax, shown ONLY while the field has focus.
 *
 * It rides in the PLACEHOLDER rather than on a line of its own, which is what
 * keeps the component exactly one line tall in every state — a hint that
 * appears below on focus would still push the page down the moment the field
 * is tapped. The resting placeholder carries no instructions at all.
 */
const SYNTAX_HINT = "/n note · /w workout · else task";

/**
 * The dashboard's one input. Everything else on this page is a readout.
 *
 * WHY IT EXISTS. The page reports on state that mostly lives in the user's
 * head rather than in the app — the diagnosis behind this rebuild was that
 * half the working state never gets captured at all. A field that is always
 * present, needs no modal, no type picker and no due date is the cheapest
 * possible path from "thought" to "row in a table".
 *
 * NO NEW MUTATION KEY. All three destinations already have keyed, optimistic,
 * offline-registered create mutations (lib/offline-mutations.ts). This
 * component is a DISPATCHER over them, which is why nothing had to be added to
 * RESUMABLE_MUTATION_KEYS: a capture made offline is queued, persisted and
 * replayed by exactly the machinery that already carries a task, a note or a
 * gym set. Routing to a brand-new key would have been dropped on reload.
 *
 * THE WRITE NEVER BLOCKS. `mutate` is fire-and-forget: with networkMode
 * "offlineFirst" the mutation pauses rather than rejecting when there is no
 * connection, so the field clears and confirms immediately in both cases. The
 * confirmation names the DESTINATION, which is known deterministically at
 * submit time and does not depend on the request landing — the hooks' own
 * toasts carry the server-confirmed detail (including, for /w, whether the
 * shorthand actually parsed).
 *
 * THE REFRESH IS A PROPERTY OF THE MUTATION, NOT OF THIS COMPONENT. The
 * dashboard is a Server Component, so a query invalidation cannot move its
 * counters — only router.refresh() re-runs the server queries. That used to be
 * an `onSettled` handed to each .mutate() call, and `onSettled` fires on
 * FAILURE too: with the server unreachable but navigator.onLine still true,
 * all three capture types exhausted their retries, rolled back and toasted
 * correctly — and then refreshed anyway, re-fetching the route from a dead
 * server, which Next turned into a hard reload onto the browser's error page.
 * A capture that had already reported failure blanked the screen.
 *
 * Moving to a call-site `onSuccess` would have fixed the blanking and quietly
 * introduced a second problem: .mutate() callbacks are not part of the
 * mutation, so nothing hung off this call site survives a capture that is
 * queued offline and replayed after a reload. REFRESH_SERVER_DATA is `meta`
 * instead, which IS dehydrated, and one handler in app/providers.tsx acts on
 * it — for an online success and a replay alike, and never on failure. See
 * lib/rsc-refresh.ts.
 *
 * NO BOX, ONE LINE. It shipped as a bordered, rounded, padded card carrying a
 * permanent two-line mono legend — visually larger than the input itself, and
 * the page's SECOND bordered element. PR #42 had deliberately left the status
 * band as the only bordered thing on the dashboard, so that the border still
 * meant "these are readouts"; a second box took the meaning away. The field now
 * sits on the page background, is one line in every state, and says nothing at
 * rest. The syntax moves into the focus placeholder (SYNTAX_HINT) and the
 * destination/confirmation moves into a trailing slot on the same line.
 *
 * Routing is untouched — routeCapture, the three mutations and the confirmation
 * timing are byte-for-byte what they were. This was presentation only.
 *
 * THE DATE AFFORDANCE IS CONDITIONAL, and that is what lets it exist at all.
 * This row is one line in every state and says nothing at rest; a permanent
 * date control would break both, and at 375px would take ~70px from a ~200px
 * input. So it appears ONLY once the text actually routes to workouts — i.e.
 * from the moment "/w " has a body — and is absent for notes, for tasks and at
 * rest. Notice it still adds NO mutation key: `performed_at` rides inside the
 * existing useLogWorkout variables, which is exactly what the offline queue
 * persists and replays.
 */
export function CaptureField() {
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [confirmed, setConfirmed] = useState<CaptureDestination | null>(null);
  /** WHEN a /w capture happened. Today unless the picker says otherwise. */
  const [date, setDate] = useState<Date>(workoutToday);
  // Controlled, so one tap picks a day AND gets the calendar off a row whose
  // next action is Enter.
  const [dateOpen, setDateOpen] = useState(false);

  // The opt-in is on the hook instances, so it applies to THESE mutations and
  // not to the same hooks used by TaskForm, NoteModal, WorkoutLogSheet or the
  // workout page — all of which sit on client-rendered pages with no server
  // data to re-fetch.
  const createTask = useCreateTask(REFRESH_SERVER_DATA);
  const createNote = useCreateNote(REFRESH_SERVER_DATA);
  const logWorkout = useLogWorkout(REFRESH_SERVER_DATA);

  // A pending timer outliving the component would setState on an unmounted
  // tree when the user navigates away inside the confirmation window.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Live destination, so a mistyped prefix is visible BEFORE submitting rather
  // than only in the confirmation afterwards.
  const pending = routeCapture(value);
  // Recomputed per render, so a tab left open across IST midnight re-reads as
  // "today" instead of silently becoming a backdated capture.
  const backdated = isBackdated(date);

  function confirm(destination: CaptureDestination) {
    setConfirmed(destination);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setConfirmed(null), CONFIRM_MS);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const route = routeCapture(value);
    if (!route) return;

    hapticTap();
    // Clear first: the field must feel instant, and every destination mutation
    // is optimistic, so the row is already in the cache by the time this runs.
    setValue("");
    confirm(route.destination);

    switch (route.destination) {
      case "notes":
        // Spark: the body IS the note. The API accepts an empty title for
        // capture kinds and leaves Spark untitled rather than deriving one,
        // which would just duplicate the body on the card.
        createNote.mutate({ title: "", content: route.body, kind: "spark" });
        break;
      case "workouts":
        // Raw text, parsed server-side inside POST. One request = one offline
        // queue entry, and the parse happens on replay — `performed_at` rides
        // in the same variables, so a backdated set queued in a basement
        // replays with the day it was logged for.
        logWorkout.mutate({
          raw_input: route.body,
          performed_at: workoutPerformedAtIso(date),
        });
        // RESET, unlike the workout page's free-text field. That one is a
        // screen you navigate to with its date visible beside it; this bar is
        // always present and one line, so a date persisting invisibly behind
        // the next capture is the hazard worth designing out.
        setDate(workoutToday());
        break;
      case "tasks":
        // NO due date. An undated task is valid, and defaulting to today would
        // refill the very list this rebuild exists to keep honest.
        createTask.mutate({ title: route.body });
        break;
    }
  }

  return (
    // THE FIELD LOOKS LIKE A FIELD.
    //
    // It shipped with no fill, border or radius, on the reasoning that the
    // status band should be the only bordered thing on the page. Two things
    // undid that. The sections are now contained blocks, so "the only bordered
    // element" is no longer a property worth protecting; and with nothing
    // around it the placeholder rendered as 16px muted text alone on the
    // background — the same size as a section heading — so the one input on
    // the page read as a heading.
    //
    // Measured before changing anything, because the obvious diagnosis was
    // wrong in three places: the capture->band gap was already exactly 32, the
    // glyph was already 8px from the input's edge rather than stranded, and
    // 16px is not the largest type here (the counters are 30px). What was
    // actually missing was a container, and only that.
    //
    // BLOCK_SURFACE, not a copy of its values: the field is supposed to match
    // the sections, so it follows them wherever they are tuned to.
    //
    // h-11 (44px) replaces py-2. The old row was 52px, and that height was
    // emergent rather than chosen — the 36px submit button plus 2x8 padding.
    // Stating the height directly makes it a decision. px-4 is the block's own
    // 16, which also pulls the glyph off the right margin and in against the
    // padding.
    <form
      onSubmit={submit}
      className={cn(BLOCK_SURFACE, "flex h-11 items-center gap-2 px-4")}
    >
      <label htmlFor="capture" className="sr-only">
        Capture a task, note or workout
      </label>
      <input
        id="capture"
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // The ONLY place the syntax is ever stated, and only while focused.
        placeholder={focused ? SYNTAX_HINT : "Capture anything…"}
        autoComplete="off"
        enterKeyHint="done"
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />

      {/* Destination feedback rides on the SAME line as the input rather than
          under it. Both strings are short ("→ notes", "Added to workouts") and
          the input is min-w-0 flex-1, so it gives up width smoothly instead of
          the row growing a second line. */}
      {confirmed ? (
        <span
          className="shrink-0 font-mono text-xs text-success"
          role="status"
        >
          Added to {CAPTURE_DESTINATION_LABEL[confirmed]}
        </span>
      ) : pending ? (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          → {CAPTURE_DESTINATION_LABEL[pending.destination]}
        </span>
      ) : null}

      {/* WHEN, for workout captures only.
          Icon alone while the date is today — the default costs no width and
          draws no attention. Backdated, it widens to state the day in the
          accent, because a capture going somewhere other than today must never
          look identical to one that isn't. Mono 12px is the Meta rank, the
          same rank as the destination hint and the ↵ beside it.
          `type="button"`: inside a form, an unset type submits. */}
      {pending?.destination === "workouts" && (
        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={
                backdated
                  ? `Logging for ${workoutDateShortLabel(date)} — change date`
                  : "Logging for today — change date"
              }
              className={cn(
                "flex h-9 shrink-0 items-center gap-1 rounded-md px-1 font-mono text-xs transition-colors",
                backdated
                  ? "text-accent"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <CalendarIcon aria-hidden className="h-3.5 w-3.5" />
              {backdated && <span>{workoutDateShortLabel(date)}</span>}
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto p-0"
            // Anchored right: at 375px a left-aligned calendar from a control
            // this close to the edge overflows the viewport.
            align="end"
            // Radix would restore focus to the trigger; the next thing anyone
            // does after picking a day is press Enter, so send it to the input.
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              inputRef.current?.focus();
            }}
          >
            <Calendar
              mode="single"
              selected={date}
              // A tap on the selected day hands back undefined. There is no
              // "no date" here — keep what is set, and close either way.
              onSelect={(d) => {
                if (d) setDate(d);
                setDateOpen(false);
              }}
              // No future dates: a set you have not done yet is not a log.
              disabled={{ after: workoutToday() }}
              defaultMonth={date}
              autoFocus
            />
          </PopoverContent>
        </Popover>
      )}

      {/* THE GLYPH IS A CHARACTER, NOT AN ICON IN A BOX. It shipped as a 28px
          `rounded-md bg-surface-raised` tile around a lucide arrow — a filled
          surface, which is the one thing this direction does not have. `↵`
          (U+21B5) says the same thing in the type system: it is submit, drawn
          in the mono face at the meta rank, and it earns its enabled state with
          colour rather than with a background. The 36px box keeps the tap
          target finger-sized without drawing anything. */}
      <button
        type="submit"
        disabled={!pending}
        aria-label={
          pending
            ? `Add to ${CAPTURE_DESTINATION_LABEL[pending.destination]}`
            : "Add"
        }
        className={cn(
          // text-xs, not text-sm: the glyph is mono at the 12px Meta rank. At
          // 14 it was the page's one off-scale size — 14 is the sans Body
          // rank, and one rank per size is the rule.
          "flex h-9 w-9 shrink-0 items-center justify-center font-mono text-xs transition-colors",
          pending
            ? "text-foreground hover:text-accent"
            : "text-muted-foreground/40"
        )}
      >
        <span aria-hidden>↵</span>
      </button>
    </form>
  );
}
