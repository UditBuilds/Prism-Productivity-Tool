import Link from "next/link";
import { Bell, BookOpen, AlertCircle } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import {
  istDayContext,
  istDateString,
  istDayNumber,
  formatDueDate,
  formatCountdown,
  formatReminderTime,
  countdownProgressPct,
} from "@/lib/date";
import { cn } from "@/lib/utils";
import { renderMarkdown } from "@/lib/markdown";
import { groupRecurringBacklog } from "@/components/tasks/group-backlog";
import type { Countdown, Note, Reminder, Task } from "@/types/database";
import { NotificationNudge } from "@/components/dashboard/NotificationNudge";
import { PushHealthBanner } from "@/components/dashboard/PushHealthBanner";
import { CaptureField } from "@/components/dashboard/CaptureField";
import { TrainingPanel } from "@/components/dashboard/TrainingPanel";
import { AgendaTaskRow } from "@/components/dashboard/AgendaTaskRow";
import { UpcomingTaskRow } from "@/components/dashboard/UpcomingTaskRow";
import { DashboardRow } from "@/components/dashboard/DashboardRow";
import { StatusBand } from "@/components/dashboard/StatusBand";
import { SectionPanel } from "@/components/dashboard/SectionPanel";
import { StatCard } from "@/components/shared/StatCard";
import { DayRail } from "@/components/shared/DayRail";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { EmptyState } from "@/components/shared/EmptyState";

export const metadata = { title: "Dashboard | Prism" };

const DAY_MS = 86_400_000;

/** Rows rendered in the agenda before it links out. */
const AGENDA_LIMIT = 4;

/**
 * How many task rows each agenda query fetches. Larger than AGENDA_LIMIT
 * because recurring instances are CONSOLIDATED after fetching — grouping a
 * page of 4 would report a backlog of 4 for a template with 30 open days. The
 * "+N more" arithmetic uses exact counts, so anything past this cap is still
 * counted, just not grouped.
 */
const AGENDA_FETCH = 50;

export default async function DashboardHome() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // layout already redirects unauthenticated users

  const { startOfToday, endOfToday } = istDayContext();
  const nowIso = new Date().toISOString();

  // Agenda window: overdue (unbounded back) + today + the next 7 IST days.
  // endOfToday IS 00:00 IST tomorrow and IST is a fixed +05:30 with no DST, so
  // adding whole days to that instant lands on IST midnight every time. Never
  // civil Date field math here — on UTC Vercel it shifts back a day.
  const weekEndIso = new Date(Date.parse(endOfToday) + 7 * DAY_MS).toISOString();
  // Last civil IST date inside that window, for the countdowns (civil DATE)
  // query: endOfToday + 6 days is 00:00 IST on day+7.
  const weekEndCivil = istDateString(Date.parse(endOfToday) + 6 * DAY_MS);
  // Day Rail window: IST midnight 6 days ago → today + 6 back = 7 cells.
  const railStartIso = new Date(
    Date.parse(startOfToday) - 6 * DAY_MS
  ).toISOString();

  const [
    overdueRes,
    todayRes,
    weekTasksRes,
    openRes,
    cardsRes,
    weekRemindersRes,
    weekCountdownsRes,
    railSetsRes,
    lastSetRes,
    revisitRes,
  ] = await Promise.all([
    // THE OVERDUE FIX. Nothing on this page previously selected below the start
    // of today, so a task that slipped its date matched no query and vanished
    // — the dashboard rendered "All clear for today" over real outstanding
    // work. Unbounded backwards on purpose: drift has no floor.
    supabase
      .from("tasks")
      .select("*", { count: "exact" })
      .neq("status", "done")
      .not("due_date", "is", null)
      .lt("due_date", startOfToday)
      .order("due_date", { ascending: true })
      .limit(AGENDA_FETCH),
    supabase
      .from("tasks")
      .select("*", { count: "exact" })
      .neq("status", "done")
      .gte("due_date", startOfToday)
      .lt("due_date", endOfToday)
      .order("due_date", { ascending: true })
      .limit(AGENDA_FETCH),
    supabase
      .from("tasks")
      .select("*", { count: "exact" })
      .neq("status", "done")
      .not("due_date", "is", null)
      .gte("due_date", endOfToday)
      .lt("due_date", weekEndIso)
      .order("due_date", { ascending: true })
      .limit(AGENDA_FETCH),
    // OPEN counter — every unfinished task, dated or not. The two undated ones
    // are exactly the kind of state the capture field creates, so a counter
    // that only saw dated work would under-report the moment capture is used.
    supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .neq("status", "done"),
    supabase
      .from("srs_cards")
      .select("*", { count: "exact", head: true })
      .lte("next_review", nowIso),
    // Task-linked reminders are excluded: the task's own row already
    // represents it, so listing both shows the same thing twice.
    supabase
      .from("reminders")
      .select("*", { count: "exact" })
      .eq("is_sent", false)
      .is("task_id", null)
      .gte("remind_at", nowIso)
      .lt("remind_at", weekEndIso)
      .order("remind_at", { ascending: true })
      .limit(AGENDA_LIMIT),
    supabase
      .from("countdowns")
      .select("*", { count: "exact" })
      .gte("target_date", istDateString())
      .lte("target_date", weekEndCivil)
      .order("target_date", { ascending: true })
      .limit(AGENDA_LIMIT),
    // Day Rail: which of the last 7 IST days had at least one set.
    supabase
      .from("workout_sets")
      .select("performed_at")
      .gte("performed_at", railStartIso),
    // TRAINED: days since the most recent set. Unbounded back — the rail's
    // 7-day window can't answer "5d" once the gap exceeds a week.
    supabase
      .from("workout_sets")
      .select("performed_at")
      .order("performed_at", { ascending: false })
      .limit(1),
    supabase
      .from("notes")
      .select("*")
      .eq("kind", "revisit")
      .order("updated_at", { ascending: false })
      .limit(3),
  ]);

  const overdueCount = overdueRes.count ?? 0;
  const openCount = openRes.count ?? 0;
  const cardsCount = cardsRes.count ?? 0;
  const revisitNotes: Note[] = revisitRes.data ?? [];
  const revisitError = revisitRes.error ? "Couldn't load your revisit notes" : null;

  // ── TRAINED ────────────────────────────────────────────────────────
  // Days since the last set, as IST CIVIL day distance — not elapsed hours.
  // A set logged at 23:00 last night is "1d" this morning, not "0d".
  const lastSetAt = lastSetRes.data?.[0]?.performed_at ?? null;
  const daysSinceTrained =
    lastSetAt === null
      ? null
      : istDayNumber(Date.now()) - istDayNumber(Date.parse(lastSetAt));
  const trainedLabel =
    daysSinceTrained === null
      ? "—"
      : daysSinceTrained <= 0
        ? "today"
        : `${daysSinceTrained}d`;

  const railError = railSetsRes.error !== null;
  const trainedDays = new Set(
    (railSetsRes.data ?? []).map((r) => istDateString(Date.parse(r.performed_at)))
  );
  const todayKey = istDateString();
  const railStartMs = Date.parse(railStartIso);
  const trainedRailDays = Array.from({ length: 7 }, (_, i) => {
    const key = istDateString(railStartMs + i * DAY_MS);
    return { filled: trainedDays.has(key), isToday: key === todayKey };
  });
  const trainedDayCount = trainedRailDays.filter((d) => d.filled).length;

  // ── Agenda ─────────────────────────────────────────────────────────
  // Overdue first (oldest first), then today, then the next 7 days. Recurring
  // instances are consolidated ACROSS the whole span before slicing, so a
  // template with an overdue pile occupies one row rather than four.
  const overdueTasks: Task[] = overdueRes.data ?? [];
  const todayTasks: Task[] = todayRes.data ?? [];
  const weekTasks: Task[] = weekTasksRes.data ?? [];
  const weekReminders: Reminder[] = weekRemindersRes.data ?? [];
  const weekCountdowns: Countdown[] = weekCountdownsRes.data ?? [];

  const agendaError =
    overdueRes.error ||
    todayRes.error ||
    weekTasksRes.error ||
    weekRemindersRes.error ||
    weekCountdownsRes.error
      ? "Couldn't load what's due"
      : null;

  // One grouping pass over every task in the window. Fed oldest-first, so a
  // consolidated group lands in its OLDEST instance's slot (it is overdue
  // work) while the newest instance fronts the row — the same rule TaskList
  // applies on the tasks page.
  const groupedTasks = groupRecurringBacklog([
    ...overdueTasks,
    ...todayTasks,
    ...weekTasks,
  ]);

  type AgendaItem =
    | { kind: "task"; sortKey: number; task: Task; backlog: number }
    | { kind: "reminder"; sortKey: number; reminder: Reminder }
    | { kind: "countdown"; sortKey: number; countdown: Countdown };

  const agendaItems: AgendaItem[] = [
    ...groupedTasks.map((g): AgendaItem => {
      // Sort on the OLDEST instance so a consolidated group keeps its overdue
      // position; the fronting row still shows the newest instance's date.
      const oldest = g.backlog[0] ?? g.task;
      return {
        kind: "task",
        sortKey: Date.parse(oldest.due_date as string),
        task: g.task,
        backlog: g.backlog.length,
      };
    }),
    ...weekReminders.map(
      (r): AgendaItem => ({
        kind: "reminder",
        sortKey: Date.parse(r.remind_at),
        reminder: r,
      })
    ),
    ...weekCountdowns.map(
      (c): AgendaItem => ({
        kind: "countdown",
        sortKey: Date.parse(`${c.target_date}T00:00:00.000+05:30`),
        countdown: c,
      })
    ),
  ].sort((a, b) => a.sortKey - b.sortKey);

  const shownAgenda = agendaItems.slice(0, AGENDA_LIMIT);

  // Overflow counts underlying ROWS, not displayed items: a consolidated task
  // row stands for 1 + backlog of them, so subtracting the displayed count
  // would over-report by the size of every collapsed pile.
  const agendaTotal =
    (overdueRes.count ?? overdueTasks.length) +
    (todayRes.count ?? todayTasks.length) +
    (weekTasksRes.count ?? weekTasks.length) +
    (weekRemindersRes.count ?? weekReminders.length) +
    (weekCountdownsRes.count ?? weekCountdowns.length);
  const agendaRepresented = shownAgenda.reduce(
    (n, item) => n + (item.kind === "task" ? 1 + item.backlog : 1),
    0
  );
  const agendaOverflow = Math.max(0, agendaTotal - agendaRepresented);

  return (
    <div>
      {/* Reminder pipeline health — renders only when something is broken */}
      <PushHealthBanner />

      {/* Notification permission nudge (renders only while undecided) */}
      <NotificationNudge />

      {/* The one input on the page. Above the band because capture is the
          cheapest action here and should never require scrolling to find —
          the diagnosis behind this rebuild is that state which never reaches
          the app is the real gap, not how the app presents what it has. */}
      <CaptureField />

      {/* Status band — four DRIFT readouts. They answer "what is slipping?",
          which on a normal day has an answer, where the old four ("due today",
          "done", "review", "reminders") were three zeros and a number.

          See StatusBand for why this one section bleeds to the viewport edge:
          the Day Rail is 81px intrinsic and four columns plus any inset gap
          cannot fit 375px, so it re-applies the page gutter as its own padding
          and keeps the columns at 82.75px. Unchanged here — only what the
          cells READ has changed. */}
      <StatusBand
        className="mt-8"
        counters={
          <div className="grid grid-cols-4 gap-1">
            <StatCard
              variant="strip"
              label="Overdue"
              value={overdueCount}
              valueVariant={overdueCount > 0 ? "default" : "muted"}
              href="/dashboard/tasks?filter=todo"
            />
            {/* Straight into the review session, not the Learn index — the
                number IS the due-card count. Keeps its amber: review debt is
                the one counter the design system ranks as owed rather than
                merely non-zero. */}
            <StatCard
              variant="strip"
              label="Review"
              value={cardsCount}
              valueVariant={cardsCount > 0 ? "warning" : "muted"}
              href="/dashboard/learn/review"
            />
            {/* TRAINED is a DURATION, not a count, so the zero/non-zero rule
                doesn't map onto it: "0" would be the best possible state and
                would render muted. It reads muted only when there is nothing
                to report at all. */}
            <StatCard
              variant="strip"
              label="Trained"
              value={trainedLabel}
              valueVariant={daysSinceTrained === null ? "muted" : "default"}
              href="/dashboard/workout"
              subtitle={
                railError ? (
                  <p className="mt-2 truncate text-xs text-muted-foreground">
                    Load failed
                  </p>
                ) : (
                  <DayRail
                    days={trainedRailDays}
                    fillClassName="bg-success"
                    outlineClassName="border-success"
                    label={`${trainedDayCount} of 7 days trained`}
                    className="mt-2"
                  />
                )
              }
            />
            <StatCard
              variant="strip"
              label="Open"
              value={openCount}
              valueVariant={openCount > 0 ? "default" : "muted"}
              href="/dashboard/tasks"
            />
          </div>
        }
      />

      {/* One time-ordered list replacing Due Today AND Upcoming. Splitting them
          meant an overdue item belonged to neither: Due Today filtered to
          today's window and Upcoming started at tomorrow, so the gap swallowed
          exactly the work that had slipped. */}
      {(agendaError || shownAgenda.length > 0) && (
        <SectionPanel
          title="Today & next 7 days"
          href="/dashboard/tasks"
          variant="plain"
        >
          {agendaError ? (
            <EmptyState
              icon={AlertCircle}
              title={agendaError}
              description="Try refreshing."
              density="compact"
            />
          ) : (
            /* `divide-y` ALONE — never `divide-y divide-border`. The colour
               utility emits a `& > :not([hidden]) ~ :not([hidden])` rule that
               outranks border-l-danger and silently strips the priority accent
               from every row after the first. The hairline inherits its colour
               from the base border rule instead. */
            <ul className="divide-y">
              {shownAgenda.map((item) => {
                if (item.kind === "task") {
                  const due = formatDueDate(item.task.due_date);
                  const isFuture =
                    Date.parse(item.task.due_date as string) >=
                    Date.parse(endOfToday);
                  // Owed work (overdue, today) offers mark-done; work that
                  // isn't due yet doesn't. Pre-existing decision, kept.
                  return isFuture ? (
                    <UpcomingTaskRow
                      key={`task-${item.task.id}`}
                      task={item.task}
                      dueLabel={due?.label ?? null}
                    />
                  ) : (
                    <AgendaTaskRow
                      key={`task-${item.task.id}`}
                      task={item.task}
                      dueLabel={due?.label ?? null}
                      dueTone={due?.tone ?? "muted"}
                      backlogCount={item.backlog}
                    />
                  );
                }

                if (item.kind === "countdown") {
                  const c = item.countdown;
                  const display = formatCountdown(c.target_date);
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
                        // 24 = the Glyph rank. text-xl (20) was the one
                        // off-scale size on this page.
                        <span className="text-2xl transition-transform group-hover:scale-110">
                          {c.emoji}
                        </span>
                      }
                      title={c.title}
                      below={
                        <ProgressBar
                          className="mt-2"
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

                const r = item.reminder;
                const display = formatReminderTime(r.remind_at);
                const withinHour =
                  Date.parse(r.remind_at) - Date.now() < 3_600_000;
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

          {!agendaError && agendaOverflow > 0 && (
            <Link
              href="/dashboard/tasks"
              className="block border-t border-border p-4 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              +{agendaOverflow} more
            </Link>
          )}
        </SectionPanel>
      )}

      {/* Training drift — client island off the 180-day analysis endpoint.
          Replaces the workout link row, which duplicated a nav tab. */}
      <TrainingPanel />

      {/* Revisit — notes saved to be re-read, never quizzed. Moved to the
          bottom: it is the only section here that is not about drift. */}
      {(revisitError || revisitNotes.length > 0) && (
        <SectionPanel
          title="Revisit"
          count={revisitNotes.length}
          href="/dashboard/notes?kind=revisit"
          linkLabel="View all"
          variant="plain"
        >
          {revisitError ? (
            <EmptyState
              icon={AlertCircle}
              title={revisitError}
              description="Try refreshing."
              density="compact"
            />
          ) : (
            <ul className="divide-y">
              {revisitNotes.map((n) => (
                <li key={n.id} className="p-4">
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
        </SectionPanel>
      )}
    </div>
  );
}
