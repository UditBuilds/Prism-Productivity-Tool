"use client";

import { useState } from "react";
import { Plus, CalendarDays, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatCountdown, countdownProgressPct } from "@/lib/date";
import { useCountdownsQuery, useDeleteCountdown } from "@/hooks/useCountdowns";
import { Button } from "@/components/ui/button";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { CountdownForm } from "./CountdownForm";

const toneClass: Record<string, string> = {
  accent: "text-accent font-semibold",
  warning: "text-warning font-medium",
  muted: "text-muted-foreground",
  dimmed: "text-muted-foreground/50",
};

export function CountdownsTab() {
  const [formOpen, setFormOpen] = useState(false);
  const { data: countdowns, isLoading, isError, refetch } =
    useCountdownsQuery();
  const deleteCountdown = useDeleteCountdown();

  return (
    <div>
      {isLoading ? (
        <LoadingSkeleton count={2} />
      ) : isError ? (
        <EmptyState
          icon={CalendarDays}
          title="Couldn't load countdowns"
          description="Something went wrong fetching your countdowns."
          action={
            <Button variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          }
        />
      ) : (countdowns?.length ?? 0) === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No countdowns yet"
          description="Count down to exams, launches, birthdays, trips."
          action={
            <Button onClick={() => setFormOpen(true)} className="rounded-lg">
              <Plus className="mr-1.5 h-4 w-4" />
              New Countdown
            </Button>
          }
        />
      ) : (
        <>
          <ul className="space-y-2">
            {countdowns?.map((c) => {
              const display = formatCountdown(c.target_date);
              return (
                <li
                  key={c.id}
                  className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
                >
                  <span aria-hidden className="text-2xl">
                    {c.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {c.title}
                    </p>
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{
                          width: `${countdownProgressPct(
                            c.created_at,
                            c.target_date
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                  <span className={cn("shrink-0 text-sm", toneClass[display.tone])}>
                    {display.label}
                  </span>
                  <button
                    type="button"
                    aria-label={`Delete ${c.title}`}
                    onClick={() => deleteCountdown.mutate(c.id)}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-60 hover:bg-surface-raised hover:text-danger group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
          <Button
            variant="outline"
            onClick={() => setFormOpen(true)}
            className="mt-4 w-full rounded-lg"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            New Countdown
          </Button>
        </>
      )}

      <CountdownForm open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  );
}
