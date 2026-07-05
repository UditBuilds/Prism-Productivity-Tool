"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CalendarCheck,
  Lightbulb,
  Moon,
  Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useWeeklyReview, type ReviewWeek } from "@/hooks/useWeeklyReview";
import { useFocusCategories } from "@/hooks/useFocusCategories";
import type {
  ReviewDayHighlight,
  WeeklyReviewData,
} from "@/app/api/review/weekly/route";
import { moodOption } from "@/components/dashboard/moods";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatCard } from "@/components/shared/StatCard";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { ProgressBar } from "@/components/shared/ProgressBar";

function fmtMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "2026-06-09" → "9 Jun" without timezone-shifting the civil date. */
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function shortDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${Number.parseInt(d, 10)} ${MONTHS[Number.parseInt(m, 10) - 1]}`;
}

export default function WeeklyReviewPage() {
  const [week, setWeek] = useState<ReviewWeek>("current");
  const { data, isLoading, isError, refetch } = useWeeklyReview(week);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Weekly Review"
        subtitle="How your week actually went"
        icon={CalendarCheck}
        actions={
          <Tabs value={week} onValueChange={(v) => setWeek(v as ReviewWeek)}>
            <TabsList className="h-9">
              <TabsTrigger value="previous" className="px-2.5 text-xs">
                Last week
              </TabsTrigger>
              <TabsTrigger value="current" className="px-2.5 text-xs">
                This week
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {isLoading ? (
        <ReviewSkeleton />
      ) : isError || !data ? (
        <EmptyState
          icon={AlertCircle}
          title="Couldn't load your week"
          description="Something went wrong fetching your review."
          action={
            <Button variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          }
        />
      ) : (
        <ReviewContent week={week} data={data} />
      )}
    </div>
  );
}

function ReviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-surface p-4">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="mt-3 h-7 w-14" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function ReviewContent({
  week,
  data,
}: {
  week: ReviewWeek;
  data: WeeklyReviewData;
}) {
  const { summary, days, bestDay, worstDay, categoryBreakdown, insights } =
    data;
  const { categoryChartColor } = useFocusCategories();

  const noActivity =
    summary.focusMinutes === 0 &&
    summary.tasksDone === 0 &&
    summary.reviewsDone === 0;

  if (noActivity) {
    return (
      <div>
        <p className="mb-4 text-xs text-muted-foreground/60">
          {data.week.label}
        </p>
        <EmptyState
          icon={CalendarCheck}
          title={
            week === "current" ? "Nothing to review yet" : "A quiet week"
          }
          description="Weekly Review pulls together your focus sessions, finished tasks, and card reviews into one picture. Use Prism through the week, then come back here."
          action={
            <Button asChild variant="outline" className="rounded-lg">
              <Link href="/dashboard/focus">Start a focus session</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const maxFocus = Math.max(...days.map((d) => d.focusMinutes), 1);

  const kpis = [
    { label: "Focus Time", value: fmtMinutes(summary.focusMinutes) },
    { label: "Tasks Done", value: String(summary.tasksDone) },
    { label: "Reviews", value: String(summary.reviewsDone) },
    { label: "Active Days", value: `${summary.activeDays} / 7` },
  ];

  return (
    <div className="space-y-6">
      <p className="-mt-2 text-xs text-muted-foreground/60">
        {data.week.label}
      </p>

      {/* Summary strip */}
      <div className="stagger-children grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <StatCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            valueVariant="gradient"
            size="md"
          />
        ))}
      </div>

      {/* Best / quietest day */}
      {bestDay && (
        <div className={cn("grid gap-3", worstDay && "sm:grid-cols-2")}>
          <HighlightCard kind="best" day={bestDay} />
          {worstDay && <HighlightCard kind="quiet" day={worstDay} />}
        </div>
      )}

      {/* Mon–Sun daily strip — the heart of the page */}
      <section>
        <SectionHeader title="Day by day" accentBar />
        <ul className="stagger-children space-y-2">
          {days.map((day) => {
            const isBest = bestDay?.date === day.date;
            const hasActivity = day.score > 0;
            return (
              <li
                key={day.date}
                className={cn(
                  "rounded-xl border bg-surface px-4 py-3",
                  isBest
                    ? "border-accent/40 bg-accent/[0.05]"
                    : "border-border",
                  day.isFuture && "opacity-45"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="w-24 shrink-0 sm:w-32">
                    <p className="text-sm font-semibold text-foreground">
                      {day.dayLabel.slice(0, 3)}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground/60">
                        {shortDate(day.date)}
                      </span>
                    </p>
                  </div>

                  {day.mood && (
                    <span aria-hidden className="shrink-0 text-base">
                      {moodOption(day.mood).emoji}
                    </span>
                  )}

                  <p className="ml-auto shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {day.isFuture ? (
                      <span className="text-muted-foreground/50">Upcoming</span>
                    ) : hasActivity ? (
                      [
                        day.focusMinutes > 0
                          ? fmtMinutes(day.focusMinutes)
                          : null,
                        day.tasksDone > 0
                          ? `${day.tasksDone} task${day.tasksDone === 1 ? "" : "s"}`
                          : null,
                        day.reviewsDone > 0
                          ? `${day.reviewsDone} rev`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </p>

                  {isBest && (
                    <span className="shrink-0 rounded-full bg-accent-gradient px-2 py-0.5 text-[10px] font-semibold text-accent-foreground shadow-glow-accent-sm">
                      Best
                    </span>
                  )}
                  {day.isToday && !isBest && (
                    <span className="shrink-0 rounded-full border border-border bg-surface-raised px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      Today
                    </span>
                  )}
                </div>

                {/* Focus bar, scaled to the week's max */}
                {!day.isFuture && (
                  <ProgressBar
                    className="mt-2 bg-muted/60"
                    value={(day.focusMinutes / maxFocus) * 100}
                    fillClassName="opacity-80"
                  />
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Focus breakdown */}
      {categoryBreakdown.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold text-foreground">
            Where your focus went
          </h3>
          <ul className="mt-4 space-y-3">
            {categoryBreakdown.map((slice) => (
              <li key={slice.category}>
                <div className="flex items-center gap-2.5 text-sm">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: categoryChartColor(slice.category),
                    }}
                  />
                  <span className="min-w-0 truncate text-foreground">
                    {slice.category}
                  </span>
                  <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                    {fmtMinutes(slice.minutes)}
                  </span>
                  <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground/60">
                    {slice.percentage}%
                  </span>
                </div>
                <ProgressBar
                  className="mt-1.5 bg-muted/60"
                  value={slice.percentage}
                  variant="category"
                  color={categoryChartColor(slice.category)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Insights */}
      {insights.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Lightbulb className="h-4 w-4 text-accent" />
            Patterns this week
          </h3>
          <ul className="mt-3 space-y-2">
            {insights.map((insight) => (
              <li
                key={insight}
                className="flex items-start gap-2.5 text-sm text-muted-foreground"
              >
                <span
                  aria-hidden
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/60"
                />
                {insight}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function HighlightCard({
  kind,
  day,
}: {
  kind: "best" | "quiet";
  day: ReviewDayHighlight;
}) {
  const isBest = kind === "best";
  const stats = [
    day.focusMinutes > 0 ? fmtMinutes(day.focusMinutes) : null,
    day.tasksDone > 0 ? `${day.tasksDone} task${day.tasksDone === 1 ? "" : "s"}` : null,
    day.reviewsDone > 0 ? `${day.reviewsDone} review${day.reviewsDone === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        isBest
          ? "border-accent/40 bg-accent/[0.06]"
          : "border-border bg-surface"
      )}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground/70">
        {isBest ? (
          <Sparkles className="h-3.5 w-3.5 text-accent" />
        ) : (
          <Moon className="h-3.5 w-3.5 text-muted-foreground/60" />
        )}
        {isBest ? "Strongest day" : "Quietest day"}
      </p>
      <p className="mt-2 text-lg font-bold text-foreground">{day.dayLabel}</p>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        {stats.length > 0 ? stats.join(" · ") : "Light activity"}
      </p>
    </div>
  );
}
