"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft } from "lucide-react";

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

/** How long the "added to X" line stays up. */
const CONFIRM_MS = 2600;

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
 */
export function CaptureField() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [value, setValue] = useState("");
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
    <form onSubmit={submit} className="rounded-xl border border-border bg-surface p-4">
      <label htmlFor="capture" className="sr-only">
        Capture a task, note or workout
      </label>
      <div className="flex items-center gap-2">
        <input
          id="capture"
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Capture anything…"
          autoComplete="off"
          enterKeyHint="done"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={!pending}
          aria-label={
            pending
              ? `Add to ${CAPTURE_DESTINATION_LABEL[pending.destination]}`
              : "Add"
          }
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
            pending
              ? "bg-surface-raised text-foreground hover:text-accent"
              : "text-muted-foreground/40"
          )}
        >
          <CornerDownLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* space-inside (8): the hint belongs to the field above it. One line,
          three states — never all three at once, so the field's height only
          changes between "typing" and "not typing". */}
      <p className="mt-2 font-mono text-xs text-muted-foreground">
        {confirmed ? (
          <span className="text-success">
            Added to {CAPTURE_DESTINATION_LABEL[confirmed]}
          </span>
        ) : pending ? (
          <span>→ {CAPTURE_DESTINATION_LABEL[pending.destination]}</span>
        ) : (
          <span className="text-muted-foreground/70">
            /n note · /w workout · anything else becomes a task
          </span>
        )}
      </p>
    </form>
  );
}
