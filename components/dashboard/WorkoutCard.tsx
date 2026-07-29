"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";

import { useLogWorkout } from "@/hooks/useWorkouts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { WorkoutTodayPanel } from "@/components/dashboard/WorkoutTodayPanel";

const PLACEHOLDER = "bench 3x5 @ 80kg, squat 100x5";

/**
 * Log-then-verify workout capture. Submitting saves immediately — there is no
 * confirmation step and no preview of the parse. The sets appear once the
 * server has read the shorthand, and any row can be corrected by tapping it.
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
    <section className="mt-8">
      <SectionHeader title="Workout" accentBar />

      <div className="rounded-xl border border-border bg-surface px-4 py-3.5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-center gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={PLACEHOLDER}
            aria-label="Log a set in gym shorthand"
            enterKeyHint="done"
            className="h-9 rounded-lg font-mono text-sm"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!input.trim() || logWorkout.isPending}
            className="shrink-0 rounded-lg"
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
      </div>
    </section>
  );
}
