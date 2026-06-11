"use client";

import { useMemo } from "react";
import { SmilePlus } from "lucide-react";

import { cn } from "@/lib/utils";
import { istDateString } from "@/lib/date";
import { useMoodHistory } from "@/hooks/useMood";
import { MOODS, moodOption } from "@/components/dashboard/moods";
import type { MoodValue } from "@/types/database";
import { Skeleton } from "@/components/ui/skeleton";

const DAY_MS = 86_400_000;

/** Last-30-days mood dots + frequency breakdown (Analytics → Mood tab). */
export function MoodPanel() {
  const { data: logs, isLoading } = useMoodHistory();

  const { days, counts } = useMemo(() => {
    const byDate = new Map((logs ?? []).map((l) => [l.logged_date, l]));
    const today = istDateString();
    const list: { date: string; mood: MoodValue | null; isToday: boolean }[] =
      [];
    for (let i = 29; i >= 0; i--) {
      const date = istDateString(Date.now() - i * DAY_MS);
      list.push({
        date,
        mood: byDate.get(date)?.mood ?? null,
        isToday: date === today,
      });
    }
    const freq = new Map<string, number>();
    for (const l of logs ?? []) {
      freq.set(l.mood, (freq.get(l.mood) ?? 0) + 1);
    }
    return { days: list, counts: freq };
  }, [logs]);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-4 h-8 w-full" />
        <Skeleton className="mt-4 h-3 w-2/3" />
      </div>
    );
  }

  const hasLogs = (logs?.length ?? 0) > 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold text-foreground">
        Mood — Last 30 Days
      </h3>

      {!hasLogs ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <SmilePlus className="h-8 w-8 text-muted-foreground" />
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            Log your first mood from the dashboard to see your history here.
          </p>
        </div>
      ) : (
        <>
          {/* Day dots, oldest → today */}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {days.map((d) => (
              <span
                key={d.date}
                title={`${d.date}${d.mood ? ` — ${moodOption(d.mood).label}` : ""}`}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-sm",
                  d.mood
                    ? "bg-surface-raised"
                    : "bg-muted/60",
                  d.isToday && "h-8 w-8 ring-2 ring-accent"
                )}
              >
                {d.mood ? (
                  moodOption(d.mood).emoji
                ) : (
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40"
                  />
                )}
              </span>
            ))}
          </div>

          {/* Frequency breakdown */}
          <p className="mt-5 text-sm text-muted-foreground">
            This month:{" "}
            {MOODS.filter((m) => (counts.get(m.value) ?? 0) > 0)
              .map(
                (m) =>
                  `${m.emoji} ${counts.get(m.value)} ${m.label.toLowerCase()} day${
                    (counts.get(m.value) ?? 0) === 1 ? "" : "s"
                  }`
              )
              .join(" · ")}
          </p>
        </>
      )}
    </div>
  );
}
