"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { hapticTap } from "@/lib/haptics";
import {
  CAPTURE_DESTINATION_LABEL,
  routeCapture,
  type CaptureDestination,
} from "@/lib/capture";
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
 * The dashboard is a Server Component, so a query invalidation cannot move its
 * counters — router.refresh() is what re-runs the server queries. It fires on
 * settle rather than on submit, because there is nothing new to fetch until
 * the row exists.
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
 */
export function CaptureField() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [confirmed, setConfirmed] = useState<CaptureDestination | null>(null);

  const createTask = useCreateTask();
  const createNote = useCreateNote();
  const logWorkout = useLogWorkout();

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
    const settled = () => router.refresh();

    switch (route.destination) {
      case "notes":
        // Spark: the body IS the note. The API accepts an empty title for
        // capture kinds and leaves Spark untitled rather than deriving one,
        // which would just duplicate the body on the card.
        createNote.mutate(
          { title: "", content: route.body, kind: "spark" },
          { onSettled: settled }
        );
        break;
      case "workouts":
        // Raw text, parsed server-side inside POST. One request = one offline
        // queue entry, and the parse happens on replay.
        logWorkout.mutate({ raw_input: route.body }, { onSettled: settled });
        break;
      case "tasks":
        // NO due date. An undated task is valid, and defaulting to today would
        // refill the very list this rebuild exists to keep honest.
        createTask.mutate({ title: route.body }, { onSettled: settled });
        break;
    }
  }

  return (
    // No border, no surface, no radius: this is not a card. py-2 is the one
    // spacing value here — space-inside (8) above and below a single 20px text
    // line gives a 36px row, the same height as the agenda rows' leading bubble.
    <form onSubmit={submit} className="flex items-center gap-2 py-2">
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
