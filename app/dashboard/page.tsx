import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  Brain,
  Bell,
  Coffee,
  AlertCircle,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import {
  istDayContext,
  istDateString,
  greetingForHour,
  formatDueDate,
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
        .neq("status", "done")
        .order("due_date", { ascending: true })
        .limit(5),
      supabase
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .eq("status", "done")
        .not("completed_at", "is", null)
        .gte("completed_at", startOfWeek),
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
      // "Upcoming" = today or later (IST). Past countdowns sort FIRST on
      // target_date, so without this filter they'd hog the 3 slots forever.
      // They stay visible in the Reminders → Countdowns tab.
      supabase
        .from("countdowns")
        .select("*")
        .gte("target_date", istDateString())
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
    { label: "Due Today", value: dueCount, icon: CalendarClock },
    { label: "Done This Week", value: completedCount, icon: CheckCircle2 },
    { label: "Cards to Review", value: cardsCount, icon: Brain },
    { label: "Reminders Today", value: remindersTodayCount, icon: Bell },
  ];

  return (
    <div>
      {/* Hero: the greeting anchors the page */}
      <header className="pt-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {greetingForHour(hour)},{" "}
          <span className="text-accent">{displayName}</span>
        </h1>
      </header>

      {/* Daily mood check-in */}
      <MoodWidget />

      {/* Stats */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="cursor-default rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent/30"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {label}
              </span>
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground/40" />
            </div>
            <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-white">
              {value}
            </p>
          </div>
        ))}
      </section>

      {/* Due Today */}
      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2.5">
          <span
            aria-hidden
            className="h-5 w-0.5 self-center rounded-full bg-accent"
          />
          <h2 className="text-base font-semibold text-foreground">Due Today</h2>
          {dueCount > 0 && (
            <span className="rounded-full bg-surface-raised px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
              {dueCount}
            </span>
          )}
          <Link
            href="/dashboard/tasks"
            className="ml-auto text-sm font-medium text-accent hover:text-accent-hover"
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
              {dueTasks.map((task) => {
                const due = formatDueDate(task.due_date);
                return (
                  <li key={task.id}>
                    <Link
                      href={`/dashboard/tasks/${task.id}`}
                      className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            "min-w-0 truncate text-sm font-medium text-foreground",
                            task.status === "done" &&
                              "text-muted-foreground line-through"
                          )}
                        >
                          {task.title}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-md px-2 py-0.5 text-xs font-medium capitalize",
                            priorityStyles[task.priority]
                          )}
                        >
                          {task.priority}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                            statusStyles[task.status]
                          )}
                        >
                          {statusLabel[task.status]}
                        </span>
                      </div>
                      {due && (
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {due.label}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
          </ul>
        )}
      </section>

      {/* Upcoming countdowns */}
      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2.5">
          <span
            aria-hidden
            className="h-5 w-0.5 self-center rounded-full bg-accent"
          />
          <h2 className="text-base font-semibold text-foreground">Upcoming</h2>
          <Link
            href="/dashboard/reminders"
            className="ml-auto text-sm font-medium text-accent hover:text-accent-hover"
          >
            + Add countdown
          </Link>
        </div>

        {countdowns.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-sm text-muted-foreground">
              Nothing coming up ·{" "}
              <Link
                href="/dashboard/reminders"
                className="text-accent underline underline-offset-2"
              >
                Add countdown
              </Link>
            </p>
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
