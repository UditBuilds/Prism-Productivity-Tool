"use client";

import { useState } from "react";
import { Dumbbell, Loader2, Plus } from "lucide-react";

import { useLogWorkout } from "@/hooks/useWorkouts";
import type { StructuredSetInput } from "@/lib/workouts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/PageHeader";
import { SectionPanel } from "@/components/dashboard/SectionPanel";
import { WorkoutLogSheet } from "@/components/workout/WorkoutLogSheet";
import { WorkoutTodayPanel } from "@/components/workout/WorkoutTodayPanel";

const PLACEHOLDER = "bench 3x5 @ 80kg, squat 100x5";

/**
 * Workout's own page. Previously a card on the dashboard, where the picker CTA,
 * the free-text field and the day's sets competed for a slot too small for any
 * of them — and where a logging surface sat permanently on a screen whose job
 * is the day's tasks.
 *
 * The logging behaviour is UNCHANGED from the dashboard card: same picker, same
 * steppers, same batching, same free-text fallback. Only the container moved.
 *
 * TWO PATHS INTO ONE TABLE. "Log sets" opens the structured picker, which is
 * the primary path: pick an exercise, tap weight and reps, done — no sentence
 * to compose on a phone. The free-text field below it is UNCHANGED and stays
 * fully Groq-parsed; it is the fallback for a whole session in one line, and
 * for anything the picker doesn't know. Both submit through the same mutation
 * to the same route and land as the same rows.
 *
 * KNOWN ISSUE — dev-mode hydration warning. Next still server-renders this
 * client page, but the set list is React Query data that only exists on the
 * client, and the GET /api/workouts fired on mount can resolve before hydration
 * finishes. React then finds a <ul> where the server sent the loading <div> and
 * reports "Expected server HTML to contain a matching <ul> in <div>", switching
 * the subtree to client rendering. Logging, editing, deleting and offline
 * replay all work — but the warning is real. It is the same race that makes the
 * tasks-page filter counts flash zero (Known Issues #1 in CLAUDE.md). Attempted
 * and NOT sufficient: a useState+useEffect mounted flag, useSyncExternalStore
 * with a server snapshot, next/dynamic with ssr:false, and dropping ["workouts"]
 * from the persisted caches. Do not re-try those without reproducing first.
 */
export default function WorkoutPage() {
  const logWorkout = useLogWorkout();
  const [input, setInput] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  /**
   * The in-progress session draft lives HERE, not inside the sheet, so closing
   * the sheet — including an accidental backdrop tap — cannot discard eight
   * exercises of work. Only a successful save or an explicit Clear empties it.
   *
   * It is page state, so navigating away still drops it. That is the same
   * bargain the dashboard card made (its state died on navigation too), and the
   * page makes it less likely to be hit rather than more: logging no longer
   * competes with a screen the user is passing through.
   */
  const [session, setSession] = useState<StructuredSetInput[]>([]);

  function submit() {
    const raw = input.trim();
    if (!raw || logWorkout.isPending) return;
    logWorkout.mutate({
      raw_input: raw,
      // Stamped here so a set queued offline keeps the time it was logged,
      // not the time it eventually synced.
      performed_at: new Date().toISOString(),
    });
    setInput("");
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Workout"
        subtitle="Log sets as you lift — offline is fine, it syncs later."
        icon={Dumbbell}
      />

      {/* mt-0 overrides SectionPanel's between-sections 32: PageHeader already
          owns the space above the first section. */}
      <SectionPanel title="Log" className="mt-0">
        <Button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="h-9 w-full rounded-md"
        >
          <Dumbbell aria-hidden className="h-4 w-4" />
          {/* The count is the only cue that a closed sheet still holds a draft. */}
          {session.length > 0
            ? `Resume session (${session.length} set${
                session.length === 1 ? "" : "s"
              })`
            : "Log sets"}
        </Button>

        <WorkoutLogSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          session={session}
          setSession={setSession}
        />

        {/* The free-text fallback, unchanged. 16 from the primary CTA — it is a
            separate object, not part of it. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="mt-4 flex items-center gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={PLACEHOLDER}
            aria-label="Log a set in gym shorthand"
            enterKeyHint="done"
            className="h-9 rounded-md font-mono text-sm"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!input.trim() || logWorkout.isPending}
            className="shrink-0 rounded-md"
          >
            {logWorkout.isPending ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            ) : (
              <Plus aria-hidden className="h-4 w-4" />
            )}
            <span className="sr-only">Log set</span>
          </Button>
        </form>
      </SectionPanel>

      {/* Today's sets and the 21-day session count. `card`, not `list`: these
          rows are tier-2 bubbles grouped under per-exercise MonoLabels, not
          edge-to-edge partitions of the card — the same shape they had on the
          dashboard, kept deliberately. */}
      <SectionPanel title="Today">
        <WorkoutTodayPanel />
      </SectionPanel>
    </div>
  );
}
