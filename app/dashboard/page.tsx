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
  formatReminderTime,
  countdownProgressPct,
} from "@/lib/date";
import { cn } from "@/lib/utils";
import type { Countdown, Reminder, Task } from "@/types/database";
import { MoodWidget } from "@/components/dashboard/MoodWidget";
import { NotificationNudge } from "@/components/dashboard/NotificationNudge";
import { DueTodayRow } from "@/components/dashboard/DueTodayRow";
import { StatCard } from "@/components/shared/StatCard";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { EmptyState } from "@/components/shared/EmptyState";

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
        <StatCard
          label="Due Today"
          value={dueCount}
          icon={CalendarClock}
          pulse={dueCount > 0}
          iconClassName={dueCount > 0 ? "text-accent/70" : undefined}
        />
        <StatCard
          label="Done This Week"
          value={completedCount}
          icon={CheckCircle2}
          sparkline={doneSparkline}
          valueVariant={completedCount > 0 ? "gradient-success" : "default"}
          iconClassName={completedCount > 0 ? "text-accent/70" : undefined}
        />
        <StatCard
          label="Cards to Review"
          value={cardsCount}
          icon={Brain}
          iconClassName={
            cardsCount > 0 ? "animate-breathe text-accent" : undefined
          }
          className={cardsCount > 0 ? "border-warning/25" : undefined}
        />
        <StatCard
          label="Reminders Today"
          value={remindersTodayCount}
          icon={Bell}
          iconClassName={
            remindersTodayCount > 0
              ? "animate-bell-ring-loop text-accent"
              : undefined
          }
        />
      </section>

      {/* Due Today */}
      <section className="mt-8">
        <SectionHeader
          title="Due Today"
          count={dueCount}
          href="/dashboard/tasks"
          accentBar
        />

        {dueError ? (
          <EmptyState
            icon={AlertCircle}
            title="Couldn't load today's tasks"
            description="Try refreshing."
            compact
          />
        ) : dueTasks.length === 0 ? (
          <EmptyState
            icon={Coffee}
            title="All clear for today"
            description="Nothing due — a good day to get ahead."
            particles
            compact
            action={
              <Link
                href="/dashboard/tasks"
                className="text-xs font-medium text-accent hover:text-accent-hover"
              >
                Add a task →
              </Link>
            }
          />
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
        <SectionHeader
          title="Upcoming"
          accentBar
          action={
            <Link
              href="/dashboard/reminders"
              className="text-sm font-medium text-accent hover:text-accent-hover"
            >
              + Add countdown
            </Link>
          }
        />

        {upcomingItems.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Nothing coming up"
            compact
            action={
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
            }
          />
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
                        ? "text-warning font-medium"
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
                        <ProgressBar
                          className="mt-1.5"
                          value={countdownProgressPct(
                            c.created_at,
                            c.target_date
                          )}
                          variant={
                            display.tone === "warning" ? "warning" : "accent"
                          }
                        />
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
                      ? "text-warning font-medium"
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
