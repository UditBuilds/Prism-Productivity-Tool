"use client";

import Link from "next/link";
import { useIsRestoring } from "@tanstack/react-query";
import { Dumbbell } from "lucide-react";

import { useSessionCount, useTodaysSets } from "@/hooks/useWorkouts";
import { SectionPanel } from "@/components/dashboard/SectionPanel";
import { EmptyState } from "@/components/shared/EmptyState";

/**
 * The dashboard's read-only view of the gym. Logging lives at
 * /dashboard/workout — this panel reports and links, it does not capture.
 *
 * WHY NOTHING IS LOGGABLE HERE. The card this replaces carried the picker CTA,
 * a free-text field and the day's sets in one dashboard slot, so two controls
 * competed for the same job in a space too small for either. Splitting them
 * means the dashboard answers "did I train today?" — one line — and the page
 * answers "log this set" with room to do it.
 *
 * Both numbers come from `select` over the ONE persisted ["workouts"] cache, so
 * this panel adds no request to the dashboard. The same isRestoring gate the
 * set list uses applies for the same reason: isLoading reads false throughout
 * an IndexedDB restore, so it could never have been the gate on its own.
 */
export function WorkoutSummaryPanel() {
  const { data: todaySets, isLoading } = useTodaysSets();
  const { data: sessionCount } = useSessionCount();
  const restoring = useIsRestoring() || isLoading;

  const setsToday = todaySets?.length ?? 0;
  const sessions = sessionCount ?? 0;

  if (restoring) {
    return (
      <SectionPanel title="Workout">
        <div className="h-5 w-40 animate-pulse rounded bg-surface-raised" />
      </SectionPanel>
    );
  }

  // Nothing logged today — one row, same treatment as an empty Due Today. The
  // 21-day count is deliberately dropped in this branch: on a rest day the
  // honest headline is "nothing today", and pairing it with a streak-ish
  // number turns a rest day into a reproach.
  if (setsToday === 0) {
    return (
      <SectionPanel title="Workout" variant="bare">
        <EmptyState
          icon={Dumbbell}
          title="No sets logged today"
          density="inline"
          action={
            <Link
              href="/dashboard/workout"
              className="text-xs font-medium text-accent hover:text-accent-hover"
            >
              Log a workout →
            </Link>
          }
        />
      </SectionPanel>
    );
  }

  return (
    <SectionPanel title="Workout" href="/dashboard/workout" linkLabel="Log sets">
      <p className="text-sm text-foreground">
        <span className="font-mono tabular-nums">{setsToday}</span> set
        {setsToday === 1 ? "" : "s"} logged today
      </p>
      {/* The feature measuring its own use — the same line the dashboard card
          carried, on the same 8 (within one object: figure then its context). */}
      {sessions > 0 && (
        <p className="mt-2 font-mono text-xs tabular-nums text-muted-foreground">
          {sessions} session{sessions === 1 ? "" : "s"} in the last 21 days
        </p>
      )}
    </SectionPanel>
  );
}
