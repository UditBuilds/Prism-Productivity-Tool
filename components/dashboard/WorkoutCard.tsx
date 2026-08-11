"use client";

import { useState } from "react";
import { Dumbbell, Loader2, Plus } from "lucide-react";

import { useLogWorkout } from "@/hooks/useWorkouts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionPanel } from "@/components/dashboard/SectionPanel";
import { WorkoutLogSheet } from "@/components/dashboard/WorkoutLogSheet";
import { WorkoutTodayPanel } from "@/components/dashboard/WorkoutTodayPanel";

const PLACEHOLDER = "bench 3x5 @ 80kg, squat 100x5";

/**
 * Log-then-verify workout capture. Submitting saves immediately — there is no
 * confirmation step and no preview of the parse. The sets appear once the
 * server has read the shorthand, and any row can be corrected by tapping it.
 *
 * TWO PATHS INTO ONE TABLE. "Log sets" opens the structured picker, which is
 * the primary path: pick an exercise, tap weight and reps, done — no sentence
 * to compose on a phone. The free-text field below it is UNCHANGED and stays
 * fully Groq-parsed; it is the fallback for a whole session in one line, and
 * for anything the picker doesn't know. Both submit through the same mutation
 * to the same route and land as the same rows.
 *
 * KNOWN ISSUE — dev-mode hydration warning. This card is server-rendered
 * inside the dashboard page, but its list is React Query data that only exists
 * on the client, and the GET /api/workouts fired on mount can resolve before
 * hydration finishes. React then finds a <ul> where the server sent the
 * loading <div> and reports "Expected server HTML to contain a matching <ul>
 * in <div>", switching the subtree to client rendering. The card itself works
 * — logging, editing, deleting and offline replay were all verified — but the
 * warning is real. It is the same race that makes the tasks-page filter counts
 * flash zero (Known Issues #1 in CLAUDE.md). Attempted and NOT sufficient: a
 * useState+useEffect mounted flag, useSyncExternalStore with a server
 * snapshot, next/dynamic with ssr:false, and dropping ["workouts"] from the
 * persisted caches. Do not re-try those without reproducing first.
 */
export function WorkoutCard() {
  const logWorkout = useLogWorkout();
  const [input, setInput] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);

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
    <SectionPanel title="Workout">
      <Button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="h-9 w-full rounded-md"
      >
        <Dumbbell aria-hidden className="h-4 w-4" />
        Log sets
      </Button>

      <WorkoutLogSheet open={sheetOpen} onOpenChange={setSheetOpen} />

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

      <WorkoutTodayPanel />
    </SectionPanel>
  );
}
