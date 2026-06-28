import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  Brain,
  Bell,
  Coffee,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import {
  istDayContext,
  istDateString,
  greetingForHour,
  formatDueDate,
  formatCountdown,
  formatReminderTime,
  countdownProgressPct,
} from "@/lib/date";
import { cn } from "@/lib/utils";
import type { Countdown, Reminder, Task } from "@/types/database";
import { MoodWidget } from "@/components/dashboard/MoodWidget";
import { DueTodayRow } from "@/components/dashboard/DueTodayRow";

/**
 * SVG polyline points for a small sparkline (values oldest→newest). The 100×24
 * viewBox stretches to the container (preserveAspectRatio="none"); the caller's
 * vector-effect keeps the stroke undistorted. All-zero values → flat baseline.
 */
function sparklinePoints(values: number[]): string {
  const W = 100;
  const H = 24;
  const PAD = 3; // keeps the line off the top/bottom edges
  const max = Math.max(...values, 1); // avoid /0; a flat-zero week sits on the baseline
  const stepX = values.length > 1 ? W / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = i * stepX;
      const y = H - PAD - (v / max) * (H - 2 * PAD);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export const metadata = { title: "Dashboard | Prism" };

export default async function DashboardHome() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // layout already redirects unauthenticated users

  const { startOfToday, endOfToday, startOfWeek, hour } = istDayContext();
  const nowIso = new Date().toISOString();
  const DAY_MS = 86_400_000;
  // Sparkline window: IST midnight 6 days ago → covers today + 6 days back.
  const sparkWindowStartIso = new Date(
    Date.parse(startOfToday) - 6 * DAY_MS
  ).toISOString();

  const [
    profileRes,
    dueRes,
    completedRes,
    cardsRes,
    remindersRes,
    countdownsRes,
    upcomingRemindersRes,
    weekDoneRes,
  ] = await Promise.all([
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
      // Upcoming reminders (pending, now or later) — merged into "Upcoming"
      // alongside countdowns. Read-only here; created on the Reminders page.
      supabase
        .from("reminders")
        .select("*")
        .eq("is_sent", false)
        .gte("remind_at", nowIso)
        .order("remind_at", { ascending: true })
        .limit(3),
      // Tasks completed in the last 7 IST days → the "Done This Week" sparkline.
      supabase
        .from("tasks")
        .select("completed_at")
        .eq("status", "done")
        .not("completed_at", "is", null)
        .gte("completed_at", sparkWindowStartIso)
        .lte("completed_at", nowIso),
    ]);

  const displayName = profileRes.data?.display_name ?? "there";
  const dueTasks: Task[] = dueRes.data ?? [];
  const dueCount = dueRes.count ?? 0;
  const dueError = dueRes.error?.message ?? null;
  const completedCount = completedRes.count ?? 0;
  const cardsCount = cardsRes.count ?? 0;
  const remindersTodayCount = remindersRes.count ?? 0;
  const countdowns: Countdown[] = countdownsRes.data ?? [];
  const upcomingReminders: Reminder[] = upcomingRemindersRes.data ?? [];

  // Merge countdowns + reminders into one chronological list (soonest first),
  // capped at the same 3 the countdown query uses. Countdown dates are civil
  // (IST midnight); reminders are instants — both reduced to a ms sortKey.
  type UpcomingItem =
    | { kind: "countdown"; sortKey: number; countdown: Countdown }
    | { kind: "reminder"; sortKey: number; reminder: Reminder };
  const upcomingItems: UpcomingItem[] = [
    ...countdowns.map(
      (c): UpcomingItem => ({
        kind: "countdown",
        sortKey: Date.parse(`${c.target_date}T00:00:00.000+05:30`),
        countdown: c,
      })
    ),
    ...upcomingReminders.map(
      (r): UpcomingItem => ({
        kind: "reminder",
        sortKey: new Date(r.remind_at).getTime(),
        reminder: r,
      })
    ),
  ]
    .sort((a, b) => a.sortKey - b.sortKey)
    .slice(0, 3);

  // 7 IST-day completion buckets (oldest first, today last) via istDateString —
  // same IST-day approach used by the productivity analytics route.
  const dayKeys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    dayKeys.push(istDateString(Date.now() - i * DAY_MS));
  }
  const doneByDay = new Map<string, number>();
  for (const row of weekDoneRes.data ?? []) {
    if (!row.completed_at) continue;
    const key = istDateString(Date.parse(row.completed_at));
    doneByDay.set(key, (doneByDay.get(key) ?? 0) + 1);
  }
  const doneSparkline = dayKeys.map((k) => doneByDay.get(k) ?? 0);

  const stats: {
    label: string;
    value: number;
    icon: LucideIcon;
    sparkline?: number[];
  }[] = [
    { label: "Due Today", value: dueCount, icon: CalendarClock },
    {
      label: "Done This Week",
      value: completedCount,
      icon: CheckCircle2,
      sparkline: doneSparkline,
    },
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
        {stats.map(({ label, value, icon: Icon, sparkline }) => (
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
            {sparkline && (
              <svg
                viewBox="0 0 100 24"
                preserveAspectRatio="none"
                aria-hidden
                className="mt-2 h-6 w-full text-muted-foreground/50"
              >
                <polyline
                  points={sparklinePoints(sparkline)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
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
                  <DueTodayRow
                    key={task.id}
                    task={task}
                    dueLabel={due?.label ?? null}
                  />
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

        {upcomingItems.length === 0 ? (
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
              {upcomingItems.map((item) => {
                if (item.kind === "countdown") {
                  const c = item.countdown;
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
                      key={`countdown-${c.id}`}
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
                }

                const r = item.reminder;
                const display = formatReminderTime(r.remind_at);
                const toneClass =
                  display.tone === "danger"
                    ? "text-danger font-medium"
                    : display.tone === "warning"
                      ? "text-amber-400 font-medium"
                      : "text-muted-foreground";
                return (
                  <li
                    key={`reminder-${r.id}`}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
                  >
                    <span
                      aria-hidden
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-raised"
                    >
                      <Bell className="h-4 w-4 text-accent" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {r.title}
                      </p>
                      <p className={cn("mt-0.5 truncate text-xs", toneClass)}>
                        {display.label}
                      </p>
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </section>
    </div>
  );
}
