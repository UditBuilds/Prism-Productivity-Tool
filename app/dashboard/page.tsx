import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  Brain,
  Bell,
  Coffee,
  AlertCircle,
  CalendarDays,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import {
  istDayContext,
  greetingForHour,
  formatCountdown,
  countdownProgressPct,
} from "@/lib/date";
import { cn } from "@/lib/utils";
import type { Countdown, Task } from "@/types/database";
import {
  priorityStyles,
  statusStyles,
  statusLabel,
} from "@/components/tasks/task-styles";
import { QuoteCard } from "@/components/dashboard/QuoteCard";
import { MoodWidget } from "@/components/dashboard/MoodWidget";

export const metadata = { title: "Dashboard | Prism" };

export default async function DashboardHome() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // layout already redirects unauthenticated users

  const { startOfToday, endOfToday, startOfWeek, hour } = istDayContext();
  const nowIso = new Date().toISOString();

  const [profileRes, dueRes, completedRes, cardsRes, remindersRes, countdownsRes] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single(),
      supabase
        .from("tasks")
        .select("*", { count: "exact" })
        .gte("due_date", startOfToday)
        .lt("due_date", endOfToday)
        .order("due_date", { ascending: true })
        .limit(5),
      supabase
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .eq("status", "done")
        .gte("updated_at", startOfWeek),
      supabase
        .from("srs_cards")
        .select("*", { count: "exact", head: true })
        .lte("next_review", nowIso),
      supabase
        .from("reminders")
        .select("*", { count: "exact", head: true })
        .gte("remind_at", startOfToday)
        .lt("remind_at", endOfToday)
        .eq("is_sent", false),
      supabase
        .from("countdowns")
        .select("*")
        .order("target_date", { ascending: true })
        .limit(3),
    ]);

  const displayName = profileRes.data?.display_name ?? "there";
  const dueTasks: Task[] = dueRes.data ?? [];
  const dueCount = dueRes.count ?? 0;
  const dueError = dueRes.error?.message ?? null;
  const completedCount = completedRes.count ?? 0;
  const cardsCount = cardsRes.count ?? 0;
  const remindersTodayCount = remindersRes.count ?? 0;
  const countdowns: Countdown[] = countdownsRes.data ?? [];

  const stats = [
    {
      label: "Due Today",
      value: dueCount,
      icon: CalendarClock,
      accent: "border-t-warning/70",
    },
    {
      label: "Done This Week",
      value: completedCount,
      icon: CheckCircle2,
      accent: "border-t-success/70",
    },
    {
      label: "Cards to Review",
      value: cardsCount,
      icon: Brain,
      accent: "border-t-accent/70",
    },
    {
      label: "Reminders Today",
      value: remindersTodayCount,
      icon: Bell,
      accent: "border-t-blue-500/70",
    },
  ];

  return (
    <div>
      {/* Hero: greeting anchors the page; the quote is its quiet subtext */}
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {greetingForHour(hour)},{" "}
          <span className="font-bold text-accent">{displayName}</span>
        </h1>
        <QuoteCard />
      </header>

      {/* Daily mood check-in */}
      <MoodWidget />

      {/* Stats */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, accent }) => (
          <div
            key={label}
            className={cn(
              "rounded-xl border border-[#1F1F1F] border-t-2 bg-[#111111] p-4 hover:-translate-y-0.5 hover:border-[#2A2A2A] hover:shadow-lg hover:shadow-black/20 active:scale-[0.98] lg:p-6",
              accent
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-medium uppercase tracking-widest text-muted-foreground/70">
                {label}
              </span>
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground/50" />
            </div>
            <p className="mt-3 text-2xl font-bold tabular-nums tracking-tight text-white lg:text-3xl">
              {value}
            </p>
          </div>
        ))}
      </section>

      {/* Due Today */}
      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2.5 border-l-2 border-accent pl-3">
          <h2 className="text-base font-semibold text-foreground">Due Today</h2>
          {dueCount > 0 && (
            <span className="rounded-full border border-border bg-surface-raised px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
              {dueCount}
            </span>
          )}
          <Link
            href="/dashboard/tasks"
            className="ml-auto text-xs font-medium text-accent hover:text-accent-hover"
          >
            View all →
          </Link>
        </div>

        {dueError ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-raised">
              <AlertCircle className="h-5 w-5 text-danger" />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Couldn&apos;t load today&apos;s tasks. Try refreshing.
            </p>
          </div>
        ) : dueTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-raised">
              <Coffee className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="mt-3 text-sm font-medium text-foreground">
              All clear for today
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Nothing due — a good day to get ahead.
            </p>
            <Link
              href="/dashboard/tasks"
              className="mt-3 text-xs font-medium text-accent hover:text-accent-hover"
            >
              Add a task →
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
              {dueTasks.map((task) => (
                <li key={task.id}>
                  <Link
                    href={`/dashboard/tasks/${task.id}`}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 transition hover:border-[#2A2A2A] hover:bg-surface-raised/60"
                  >
                    <span
                      className={cn(
                        "truncate text-sm font-medium text-foreground",
                        task.status === "done" &&
                          "text-muted-foreground line-through"
                      )}
                    >
                      {task.title}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={cn(
                          "rounded-md px-2 py-0.5 text-xs font-medium capitalize",
                          priorityStyles[task.priority]
                        )}
                      >
                        {task.priority}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          statusStyles[task.status]
                        )}
                      >
                        {statusLabel[task.status]}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </section>

      {/* Upcoming countdowns */}
      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2.5 border-l-2 border-accent pl-3">
          <h2 className="text-base font-semibold text-foreground">Upcoming</h2>
          <Link
            href="/dashboard/reminders"
            className="ml-auto text-xs font-medium text-accent hover:text-accent-hover"
          >
            + Add countdown
          </Link>
        </div>

        {countdowns.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-raised">
              <CalendarDays className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="mt-3 text-sm font-medium text-foreground">
              Nothing coming up
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Count down to exams, trips, launches, birthdays.
            </p>
            <Link
              href="/dashboard/reminders"
              className="mt-3 text-xs font-medium text-accent hover:text-accent-hover"
            >
              + Add countdown
            </Link>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
              {countdowns.map((c) => {
                const display = formatCountdown(c.target_date);
                const toneClass =
                  display.tone === "accent"
                    ? "text-accent font-semibold"
                    : display.tone === "warning"
                      ? "text-amber-400 font-medium"
                      : display.tone === "dimmed"
                        ? "text-muted-foreground/50"
                        : "text-muted-foreground";
                return (
                  <li
                    key={c.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
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
                    <span className={cn("shrink-0 text-xs", toneClass)}>
                      {display.label}
                    </span>
                  </li>
                );
              })}
          </ul>
        )}
      </section>
    </div>
  );
}
