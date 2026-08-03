import Link from "next/link";
import {
  CalendarClock,
  Bell,
  BookOpen,
  Coffee,
  AlertCircle,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import {
  istDayContext,
  istDateString,
  formatDueDate,
  formatCountdown,
  formatReminderTime,
  countdownProgressPct,
} from "@/lib/date";
import { cn } from "@/lib/utils";
import { renderMarkdown } from "@/lib/markdown";
import type { Countdown, Note, Reminder, Task } from "@/types/database";
import { MoodWidget } from "@/components/dashboard/MoodWidget";
import { NotificationNudge } from "@/components/dashboard/NotificationNudge";
import { PushHealthBanner } from "@/components/dashboard/PushHealthBanner";
import { DueTodayRow } from "@/components/dashboard/DueTodayRow";
import { WorkoutCard } from "@/components/dashboard/WorkoutCard";
import { UpcomingTaskRow } from "@/components/dashboard/UpcomingTaskRow";
import { DashboardRow } from "@/components/dashboard/DashboardRow";
import { StatCard } from "@/components/shared/StatCard";
import { DayRail } from "@/components/shared/DayRail";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Dashboard | Prism" };

export default async function DashboardHome() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // layout already redirects unauthenticated users

  const { startOfToday, endOfToday, startOfWeek } = istDayContext();
  const nowIso = new Date().toISOString();
  const DAY_MS = 86_400_000;
  // Sparkline window: IST midnight 6 days ago → covers today + 6 days back.
  const sparkWindowStartIso = new Date(
    Date.parse(startOfToday) - 6 * DAY_MS
  ).toISOString();

  // Upcoming-task window: [00:00 IST tomorrow, 00:00 IST day+31) — i.e. the
  // next 30 IST days, today excluded (those belong to Due Today).
  // endOfToday is already 00:00 IST tomorrow, and IST is a fixed +05:30 with no
  // DST, so adding whole days to that instant lands on IST midnight every time.
  // Same instant-arithmetic pattern as sparkWindowStartIso above — never civil
  // Date field math, which would shift back a day when the server runs in UTC.
  const upcomingWindowEndIso = new Date(
    Date.parse(endOfToday) + 30 * DAY_MS
  ).toISOString();
  // Max rows rendered in Upcoming. Each source fetches at most this many (any
  // one of them could fill the list); the overflow count comes from the exact
  // row counts, not the fetched page.
  const UPCOMING_LIMIT = 5;

  // The profiles read that fed the greeting's display name is gone with it —
  // the TopBar gets that name from the layout, not from here.
  const [
    dueRes,
    completedRes,
    cardsRes,
    remindersRes,
    countdownsRes,
    upcomingRemindersRes,
    weekDoneRes,
    revisitRes,
    upcomingTasksRes,
  ] = await Promise.all([
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
      // target_date, so without this filter they'd hog the slots forever.
      // They stay visible in the Reminders → Countdowns tab.
      // The exact count (not just the fetched page) feeds the "+N more" link.
      supabase
        .from("countdowns")
        .select("*", { count: "exact" })
        .gte("target_date", istDateString())
        .order("target_date", { ascending: true })
        .limit(UPCOMING_LIMIT),
      // Upcoming reminders (pending, now or later) — merged into "Upcoming"
      // alongside countdowns. Read-only here; created on the Reminders page.
      // Task-linked reminders are excluded: the task's own row already
      // represents it, so including both would list the same thing twice.
      supabase
        .from("reminders")
        .select("*", { count: "exact" })
        .eq("is_sent", false)
        .is("task_id", null)
        .gte("remind_at", nowIso)
        .order("remind_at", { ascending: true })
        .limit(UPCOMING_LIMIT),
      // Tasks completed in the last 7 IST days → the "Done This Week" sparkline.
      supabase
        .from("tasks")
        .select("completed_at")
        .eq("status", "done")
        .not("completed_at", "is", null)
        .gte("completed_at", sparkWindowStartIso)
        .lte("completed_at", nowIso),
      // Revisit-kind notes resurface here for passive re-reading. No schedule —
      // just the three most recently touched, back in view.
      supabase
        .from("notes")
        .select("*")
        .eq("kind", "revisit")
        .order("updated_at", { ascending: false })
        .limit(3),
      // Future-dated open tasks → merged into "Upcoming". The window starts at
      // 00:00 IST TOMORROW, so today's tasks stay exclusively in Due Today and
      // never appear in both sections. Done tasks and tasks with no due_date
      // are excluded (a null due_date fails .gte, but .neq is explicit).
      supabase
        .from("tasks")
        .select("*", { count: "exact" })
        .neq("status", "done")
        .not("due_date", "is", null)
        .gte("due_date", endOfToday)
        .lt("due_date", upcomingWindowEndIso)
        .order("due_date", { ascending: true })
        .limit(UPCOMING_LIMIT),
    ]);

  const dueTasks: Task[] = dueRes.data ?? [];
  const dueCount = dueRes.count ?? 0;
  const dueError = dueRes.error?.message ?? null;
  const completedCount = completedRes.count ?? 0;
  const cardsCount = cardsRes.count ?? 0;
  const remindersTodayCount = remindersRes.count ?? 0;
  const countdowns: Countdown[] = countdownsRes.data ?? [];
  const upcomingReminders: Reminder[] = upcomingRemindersRes.data ?? [];
  const upcomingTasks: Task[] = upcomingTasksRes.data ?? [];
  const revisitNotes: Note[] = revisitRes.data ?? [];

  // A failed read must be visibly distinct from genuinely having no data.
  // Without this a broken query renders as a calm "Nothing coming up".
  // Upcoming merges three sources, so any one of them failing makes the whole
  // list untrustworthy — a partial list would silently drop rows.
  const upcomingError =
    countdownsRes.error || upcomingRemindersRes.error || upcomingTasksRes.error
      ? "Couldn't load what's coming up"
      : null;
  const revisitError = revisitRes.error ? "Couldn't load your revisit notes" : null;
  const weekDoneError = weekDoneRes.error !== null;

  // Merge countdowns + reminders + future-dated tasks into one chronological
  // list (soonest first). Countdown dates are civil (IST midnight); reminders
  // and tasks are instants — all three reduce to a ms sortKey.
  type UpcomingItem =
    | { kind: "countdown"; sortKey: number; countdown: Countdown }
    | { kind: "reminder"; sortKey: number; reminder: Reminder }
    | { kind: "task"; sortKey: number; task: Task };
  const allUpcoming: UpcomingItem[] = [
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
    ...upcomingTasks.map(
      (t): UpcomingItem => ({
        kind: "task",
        // Non-null: the query filters out null due_date.
        sortKey: new Date(t.due_date as string).getTime(),
        task: t,
      })
    ),
  ].sort((a, b) => a.sortKey - b.sortKey);

  const upcomingItems = allUpcoming.slice(0, UPCOMING_LIMIT);
  // Overflow counts every matching row across all three sources, not just the
  // page we fetched — each query returns an exact count.
  const upcomingTotal =
    (countdownsRes.count ?? countdowns.length) +
    (upcomingRemindersRes.count ?? upcomingReminders.length) +
    (upcomingTasksRes.count ?? upcomingTasks.length);
  const upcomingOverflow = Math.max(0, upcomingTotal - upcomingItems.length);

  // Bucket the fetched completions by IST civil day, then walk the current
  // IST week (Mon–Sun) into Day Rail cells. The rolling 7-day fetch window
  // always covers the week so far (Monday is at most 6 days back); days after
  // today have no data yet and render dimmed.
  const doneByDay = new Map<string, number>();
  for (const row of weekDoneRes.data ?? []) {
    if (!row.completed_at) continue;
    const key = istDateString(Date.parse(row.completed_at));
    doneByDay.set(key, (doneByDay.get(key) ?? 0) + 1);
  }
  const todayKey = istDateString();
  const weekStartMs = Date.parse(startOfWeek);
  const weekRailDays = Array.from({ length: 7 }, (_, i) => {
    const key = istDateString(weekStartMs + i * DAY_MS);
    return {
      filled: (doneByDay.get(key) ?? 0) > 0,
      isToday: key === todayKey,
      dim: key > todayKey,
    };
  });
  const activeDayCount = weekRailDays.filter((d) => d.filled).length;

  return (
    <div>
      {/* Reminder pipeline health — renders only when something is broken */}
      <PushHealthBanner />

      {/* No greeting block. It cost 68px of the first screen and said nothing
          actionable; its date now rides in the sticky TopBar beside the page
          title, where it costs nothing. */}

      {/* Notification permission nudge (renders only while undecided) */}
      <NotificationNudge />

      {/* Daily mood check-in */}
      <MoodWidget />

      {/* Stats — one four-across strip, no card chrome. At 375px each column
          is ~83px, which is what the 81px Day Rail needs and leaves no room
          for a border box, an icon, or a label longer than ~9 characters:
          hence gap-1 and the shortened labels. Colour still appears only
          where the number carries urgency (amber = review debt).

          Each counter links to where its number can be acted on. "REVIEW 16"
          is routinely the most actionable thing on the page and used to be
          inert; the tap target is the whole column, and the link adds no
          padding, so the geometry above is unchanged. */}
      <section className="mt-4 grid grid-cols-4 gap-1">
        <StatCard
          variant="strip"
          label="Due today"
          value={dueCount}
          href="/dashboard/tasks"
        />
        <StatCard
          variant="strip"
          label="Done"
          value={completedCount}
          href="/dashboard/tasks?filter=done"
          subtitle={
            // An all-empty rail would read as "no completions" — say the read
            // failed instead. EmptyState can't live in this slot (it's a
            // stat-card subtitle, not a section body), so this is the one
            // error surface on the page that isn't the shared component.
            weekDoneError ? (
              <p className="mt-1.5 truncate text-xs text-muted-foreground">
                Load failed
              </p>
            ) : (
              <DayRail
                days={weekRailDays}
                fillClassName="bg-success"
                outlineClassName="border-success"
                label={`${activeDayCount} of 7 days with completed tasks`}
                className="mt-1.5"
              />
            )
          }
        />
        {/* Straight into the review session, not the Learn index — the number
            IS the due-card count, so the tap should start reviewing them.
            No deck param = every due card, which is what this counts. */}
        <StatCard
          variant="strip"
          label="Review"
          value={cardsCount}
          valueVariant={cardsCount > 0 ? "warning" : "default"}
          href="/dashboard/learn/review"
        />
        <StatCard
          variant="strip"
          label="Reminders"
          value={remindersTodayCount}
          href="/dashboard/reminders"
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
            density="compact"
          />
        ) : dueTasks.length === 0 ? (
          // One row, not a card. A user who usually has nothing due was
          // getting the largest element on the first screen — a 205px
          // announcement that there is nothing to do — sitting exactly where
          // PRs #28/#29 had just made room for the tasks. The error branch
          // above keeps the card: that one is rare and worth the space.
          <EmptyState
            icon={Coffee}
            title="All clear for today"
            density="inline"
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

      {/* Workout capture — client island; this page stays a Server Component.
          Sits below Due Today: above it, its 148px cost the first screen the
          three task rows that are the point of this page. */}
      <WorkoutCard />

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

        {upcomingError ? (
          <EmptyState
            icon={AlertCircle}
            title={upcomingError}
            description="Try refreshing."
            density="compact"
          />
        ) : upcomingItems.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Nothing coming up"
            density="compact"
            action={
              <div className="flex justify-center gap-2">
                <Button asChild className="rounded-lg">
                  <Link href="/dashboard/reminders">+ Add countdown</Link>
                </Button>
                <Button asChild variant="outline" className="rounded-lg">
                  <Link href="/dashboard/tasks">+ Add task</Link>
                </Button>
              </div>
            }
          />
        ) : (
          <ul className="space-y-2">
              {upcomingItems.map((item) => {
                if (item.kind === "countdown") {
                  const c = item.countdown;
                  const display = formatCountdown(c.target_date);
                  // One tone, one hue. The label used to map "accent" onto
                  // amber while the bar below it rendered the same datum in
                  // Iris — a countdown due today showed as two colours at once.
                  const toneClass =
                    display.tone === "accent"
                      ? "text-accent font-semibold"
                      : display.tone === "warning"
                        ? "text-warning font-semibold"
                        : display.tone === "dimmed"
                          ? "text-muted-foreground/50"
                          : "text-muted-foreground";
                  return (
                    <DashboardRow
                      key={`countdown-${c.id}`}
                      leading={
                        <span className="text-xl transition-transform group-hover:scale-110">
                          {c.emoji}
                        </span>
                      }
                      title={c.title}
                      below={
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
                      }
                      trailing={
                        <span
                          className={cn(
                            "shrink-0 font-mono text-xs tabular-nums",
                            toneClass
                          )}
                        >
                          {display.label}
                        </span>
                      }
                    />
                  );
                }

                if (item.kind === "task") {
                  return (
                    <UpcomingTaskRow
                      key={`task-${item.task.id}`}
                      task={item.task}
                      dueLabel={formatDueDate(item.task.due_date)?.label ?? null}
                    />
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
                  <DashboardRow
                    key={`reminder-${r.id}`}
                    bubbleClassName={cn(withinHour && "ring-1 ring-warning/40")}
                    leading={
                      <Bell
                        className={cn(
                          "h-4 w-4",
                          withinHour ? "text-warning" : "text-muted-foreground"
                        )}
                      />
                    }
                    title={r.title}
                    meta={
                      <span
                        className={cn(
                          "font-mono text-xs tabular-nums",
                          toneClass
                        )}
                      >
                        {display.label}
                      </span>
                    }
                  />
                );
              })}
          </ul>
        )}

        {upcomingOverflow > 0 && (
          <Link
            href="/dashboard/tasks"
            className="mt-2 block rounded-xl border border-dashed border-border bg-surface px-4 py-2.5 text-center text-xs font-medium text-muted-foreground transition-colors hover:border-accent/25 hover:text-foreground"
          >
            +{upcomingOverflow} more
          </Link>
        )}
      </section>

      {/* Revisit — notes saved to be re-read, shown as their full text (never
          quizzed). Empty and failed reads both use the shared EmptyState, so
          "nothing saved" and "the query broke" can't be mistaken for each
          other. */}
      <section className="mt-8">
        <SectionHeader
          title="Revisit"
          count={revisitNotes.length}
          href="/dashboard/notes?kind=revisit"
          linkLabel="View all"
          accentBar
        />
        {revisitError ? (
          <EmptyState
            icon={AlertCircle}
            title={revisitError}
            description="Try refreshing."
            density="compact"
          />
        ) : revisitNotes.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Nothing to revisit"
            description="Save a note as Revisit and it resurfaces here."
            density="compact"
          />
        ) : (
          <ul className="space-y-2">
            {revisitNotes.map((n) => (
              <li
                key={n.id}
                className="rounded-xl border border-border bg-surface px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <p className="truncate text-sm font-semibold text-foreground">
                    {n.title}
                  </p>
                </div>
                {n.content.trim() && (
                  <div
                    className="prose-preview mt-2 text-sm text-muted-foreground"
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(n.content),
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
