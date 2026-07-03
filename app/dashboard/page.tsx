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
import { NotificationNudge } from "@/components/dashboard/NotificationNudge";
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

// IST-anchored hero date line (same Intl convention as TopBar — local time
// would render the wrong day on UTC Vercel between 00:00–05:30 IST).
const istHeroDateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  weekday: "long",
  day: "numeric",
  month: "long",
});

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
    variant: "due" | "done" | "cards" | "reminders";
  }[] = [
    { label: "Due Today", value: dueCount, icon: CalendarClock, variant: "due" },
    {
      label: "Done This Week",
      value: completedCount,
      icon: CheckCircle2,
      sparkline: doneSparkline,
      variant: "done",
    },
    { label: "Cards to Review", value: cardsCount, icon: Brain, variant: "cards" },
    {
      label: "Reminders Today",
      value: remindersTodayCount,
      icon: Bell,
      variant: "reminders",
    },
  ];

  return (
    <div className="animate-fade-up">
      {/* Hero: the greeting anchors the page */}
      <header className="pt-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {greetingForHour(hour)},{" "}
          <span className="text-gradient">{displayName}</span>
        </h1>
        <span
          aria-hidden
          className="mt-2 block h-0.5 w-24 origin-left animate-underline-grow rounded-full bg-accent-gradient"
        />
        <p className="mt-2 text-sm text-muted-foreground">
          {istHeroDateFmt.format(new Date())}
        </p>
      </header>

      {/* Notification permission nudge (renders only while undecided) */}
      <NotificationNudge />

      {/* Daily mood check-in */}
      <MoodWidget />

      {/* Stats */}
      <section className="stagger-children mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, sparkline, variant }) => {
          const active = value > 0;
          return (
            <div
              key={label}
              className={cn(
                "cursor-default rounded-xl border border-border bg-surface p-4 transition-[transform,border-color,background-color,box-shadow] duration-200 hover:scale-[1.01] hover:border-accent/30 hover:bg-surface-raised/60 hover:shadow-lift",
                variant === "due" && active && "animate-pulse-ring",
                variant === "cards" && active && "border-warning/25"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  {label}
                </span>
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    !active && "text-muted-foreground/40",
                    active && variant === "cards" && "animate-breathe text-accent",
                    active &&
                      variant === "reminders" &&
                      "animate-bell-ring-loop text-accent",
                    active &&
                      (variant === "due" || variant === "done") &&
                      "text-accent/70"
                  )}
                />
              </div>
              <p
                className={cn(
                  "mt-2 text-3xl font-bold tabular-nums tracking-tight",
                  variant === "done" && active
                    ? "bg-gradient-to-r from-accent to-emerald-400 bg-clip-text text-transparent"
                    : "text-white"
                )}
              >
                {value}
              </p>
              {sparkline && (
                <svg
                  viewBox="0 0 100 24"
                  preserveAspectRatio="none"
                  aria-hidden
                  className="mt-2 h-6 w-full"
                >
                  <defs>
                    <linearGradient id="spark-stroke" x1="0" y1="0" x2="1" y2="0">
                      <stop
                        offset="0%"
                        style={{
                          stopColor: "rgb(var(--accent-rgb))",
                          stopOpacity: 0.35,
                        }}
                      />
                      <stop
                        offset="100%"
                        style={{
                          stopColor: "rgb(var(--accent-soft-rgb))",
                          stopOpacity: 1,
                        }}
                      />
                    </linearGradient>
                  </defs>
                  <polyline
                    points={sparklinePoints(sparkline)}
                    fill="none"
                    stroke="url(#spark-stroke)"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              )}
            </div>
          );
        })}
      </section>

      {/* Due Today */}
      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2.5">
          <span
            aria-hidden
            className="h-5 w-0.5 self-center rounded-full bg-accent"
          />
          <h2 className="text-gradient text-base font-semibold">Due Today</h2>
          {dueCount > 0 && (
            <span className="rounded-full bg-surface-raised px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
              {dueCount}
            </span>
          )}
          <Link
            href="/dashboard/tasks"
            className="group ml-auto text-sm font-medium text-accent hover:text-accent-hover"
          >
            View all{" "}
            <span
              aria-hidden
              className="inline-block transition-transform group-hover:translate-x-0.5"
            >
              →
            </span>
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
          <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center">
            {/* Ambient floating dots — pure CSS celebration of an empty list */}
            <span aria-hidden className="particle-dot" style={{ left: "18%", bottom: "20%" }} />
            <span aria-hidden className="particle-dot" style={{ left: "36%", bottom: "10%", animationDelay: "0.9s" }} />
            <span aria-hidden className="particle-dot" style={{ left: "62%", bottom: "16%", animationDelay: "1.7s" }} />
            <span aria-hidden className="particle-dot" style={{ left: "82%", bottom: "24%", animationDelay: "2.4s" }} />
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
          <ul className="stagger-children space-y-2">
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
          <h2 className="text-gradient text-base font-semibold">Upcoming</h2>
          <Link
            href="/dashboard/reminders"
            className="ml-auto text-sm font-medium text-accent hover:text-accent-hover"
          >
            + Add countdown
          </Link>
        </div>

        {upcomingItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center">
            <p className="mb-3 text-sm text-muted-foreground">
              Nothing coming up
            </p>
            <div className="flex justify-center gap-2">
              <Link
                href="/dashboard/reminders"
                className="rounded-lg bg-accent-gradient px-4 py-2 text-sm font-medium text-white shadow-glow-accent-sm hover:bg-accent-gradient-hover"
              >
                + Add countdown
              </Link>
              <Link
                href="/dashboard/tasks"
                className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground hover:border-accent/30 hover:bg-surface-raised"
              >
                + Add task
              </Link>
            </div>
          </div>
        ) : (
          <ul className="stagger-children grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
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
                      className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-accent/25"
                    >
                      <span
                        aria-hidden
                        className="text-2xl transition-transform group-hover:scale-110"
                      >
                        {c.emoji}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {c.title}
                        </p>
                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              display.tone === "warning"
                                ? "bg-warning-gradient"
                                : "bg-accent-gradient"
                            )}
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
                const withinHour =
                  new Date(r.remind_at).getTime() - Date.now() < 3_600_000;
                const toneClass =
                  display.tone === "danger"
                    ? "text-danger font-medium"
                    : display.tone === "warning"
                      ? "text-amber-400 font-medium"
                      : "text-muted-foreground";
                return (
                  <li
                    key={`reminder-${r.id}`}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-accent/25"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-raised",
                        withinHour &&
                          "shadow-glow-accent-sm ring-1 ring-accent/40"
                      )}
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
