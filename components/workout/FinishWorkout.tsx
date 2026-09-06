"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Flag, Loader2 } from "lucide-react";

import {
  useTodaysSession,
  useUpdateWorkoutSession,
  type WorkoutSessionSummary,
} from "@/hooks/useWorkoutSessions";
import { Button } from "@/components/ui/button";
import { MonoLabel } from "@/components/shared/MonoLabel";

/**
 * A session lasting more than this is not a session, it is a session nobody
 * closed — or a backdated day finished later the same evening, where
 * `started_at` is that day's noon-IST marker rather than a real start.
 *
 * Both cases produce a duration the app has no evidence for, so it prints
 * nothing rather than "8h 41m". The exercise and set counts are always true
 * and are what the review is actually for.
 */
const MAX_CREDIBLE_DURATION_MS = 6 * 60 * 60 * 1000;

/** "47 min" / "1h 12m", or null when the number would be a guess. */
export function sessionDurationLabel(
  session: Pick<WorkoutSessionSummary, "started_at" | "ended_at">
): string | null {
  if (!session.started_at || !session.ended_at) return null;
  const ms = Date.parse(session.ended_at) - Date.parse(session.started_at);
  if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_CREDIBLE_DURATION_MS) {
    return null;
  }
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** "3 exercises · 10 sets", the one line both states share. */
function countsLine(session: WorkoutSessionSummary): string {
  const ex = `${session.exerciseCount} exercise${
    session.exerciseCount === 1 ? "" : "s"
  }`;
  const sets = `${session.setCount} set${session.setCount === 1 ? "" : "s"}`;
  return `${ex} · ${sets}`;
}

/**
 * Finish today's workout, and the review once it is finished.
 *
 * RENDERS NOTHING WHEN THERE IS NO SESSION TODAY. There is no "start workout"
 * button anywhere in this app: the session is created server-side by the first
 * set of the day, so an empty day has nothing to finish and this component has
 * nothing to say. That is the decision the brief locked in, and it is what
 * matches how these sets actually get logged — standing in a gym, between reps.
 *
 * The mount gate is the fix CLAUDE.md prescribes for this exact hydration
 * class (see RepeatSessionChips, which reproduced the error): this subtree's
 * visibility depends on a client-only cache, so the server always renders
 * null while the client can render content as soon as the restore lands —
 * which can happen BEFORE hydration finishes. useIsRestoring is documented as
 * not sufficient here; a mount flag cannot lose that race.
 */
export function FinishWorkout() {
  const { data: session } = useTodaysSession();
  const updateSession = useUpdateWorkoutSession();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || !session) return null;

  const duration = sessionDurationLabel(session);

  if (session.status === "completed") {
    return (
      <div className="mt-4 rounded-md border border-border bg-surface-raised p-4">
        <div className="flex items-start gap-2">
          <CheckCircle2
            aria-hidden
            className="mt-0.5 h-4 w-4 shrink-0 text-success"
          />
          <div className="min-w-0 flex-1">
            <MonoLabel>Workout finished</MonoLabel>
            <p className="mt-2 text-sm text-foreground">
              {countsLine(session)}
              {duration ? ` · ${duration}` : ""}
            </p>
            {session.exercises.length > 0 && (
              // The names, not just the count — "3 exercises" is a number,
              // "Leg Press, Leg Curl, Hacksquat" is the session.
              <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
                {session.exercises.join(", ")}
              </p>
            )}
          </div>
        </div>

        {/* Finishing is otherwise a one-way door reachable by a mistap, and
            this app has no undo for it anywhere else. Quiet, because reopening
            is the rare case. */}
        <button
          type="button"
          disabled={updateSession.isPending}
          onClick={() =>
            updateSession.mutate({ id: session.id, status: "active" })
          }
          className="mt-4 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          Reopen
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <Button
        type="button"
        variant="outline"
        disabled={updateSession.isPending}
        onClick={() =>
          updateSession.mutate({ id: session.id, status: "completed" })
        }
        className="h-9 w-full rounded-md"
      >
        {updateSession.isPending ? (
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
        ) : (
          <Flag aria-hidden className="h-4 w-4" />
        )}
        Finish workout
      </Button>
      {/* States what is about to be closed, so "Finish" is never a blind tap. */}
      <p className="mt-2 text-xs text-muted-foreground">
        {countsLine(session)} so far.
      </p>
    </div>
  );
}
