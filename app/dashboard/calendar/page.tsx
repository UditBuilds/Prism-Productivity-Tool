"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Bell,
  Calendar as CalendarIcon,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { istDateString, istDayNumber } from "@/lib/date";
import { useCalendarMonth } from "@/hooks/useCalendar";
import type { CalendarDayItems } from "@/app/api/calendar/route";
import { priorityStyles } from "@/components/tasks/task-styles";
import { PageHeader } from "@/components/layout/PageHeader";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { MonoLabel } from "@/components/shared/MonoLabel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";

const DAY_MS = 86_400_000;
const WEEKDAY_HEADERS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const WEEKDAYS_FULL = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];
const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/* ── IST-safe month-grid math (no local-timezone Date traps) ─────── */

/** Monday-first weekday index (0=Mon … 6=Sun) for an IST civil date. */
function weekdayMon0(dateStr: string): number {
  // Epoch day 0 (1970-01-01) was a Thursday → +3 makes Monday = 0.
  return (istDayNumber(Date.parse(`${dateStr}T00:00:00.000+05:30`)) + 3) % 7;
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map((n) => parseInt(n, 10));
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

interface GridCell {
  date: string; // YYYY-MM-DD
  dayOfMonth: number;
  inMonth: boolean;
}

/** Fixed 42-cell (6-week) grid so month navigation never shifts the layout. */
function buildMonthGrid(month: string): GridCell[] {
  const [y, m] = month.split("-").map((n) => parseInt(n, 10));
  const firstDate = `${month}-01`;
  const firstMs = Date.parse(`${firstDate}T00:00:00.000+05:30`);
  const leading = weekdayMon0(firstDate);
  const count = daysInMonth(y, m);

  return Array.from({ length: 42 }, (_, i) => {
    const offset = i - leading;
    const date = istDateString(firstMs + offset * DAY_MS);
    return {
      date,
      dayOfMonth: parseInt(date.slice(8), 10),
      inMonth: offset >= 0 && offset < count,
    };
  });
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map((n) => parseInt(n, 10));
  return `${MONTHS_FULL[m - 1]} ${y}`;
}

function dayLabel(dateStr: string): string {
  const weekday = WEEKDAYS_FULL[weekdayMon0(dateStr)];
  const [, m, d] = dateStr.split("-");
  return `${weekday}, ${parseInt(d, 10)} ${MONTHS_SHORT[parseInt(m, 10) - 1]}`;
}

const istTime12h = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

/* ── Page ────────────────────────────────────────────────────────── */

export default function CalendarPage() {
  const today = istDateString();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);

  const { data, isLoading, isError, refetch } = useCalendarMonth(month);

  const grid = useMemo(() => buildMonthGrid(month), [month]);
  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarDayItems>();
    for (const day of data?.days ?? []) map.set(day.date, day);
    return map;
  }, [data]);

  function goToMonth(next: string) {
    setMonth(next);
    setSelected(next === today.slice(0, 7) ? today : `${next}-01`);
  }

  const selectedItems = itemsByDate.get(selected) ?? null;
  const monthIsEmpty = !isLoading && !isError && (data?.days.length ?? 0) === 0;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Calendar"
        subtitle="Tasks and reminders by date"
        icon={CalendarIcon}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
        {/* Month grid card — tier 1, one padding step at every width. */}
        <div className="rounded-xl border border-border bg-surface p-4">
          {/* Month navigation */}
          <SectionHeader
            title={monthLabel(month)}
            className="mb-4"
            action={
              <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => goToMonth(today.slice(0, 7))}
                className="rounded-lg text-xs text-muted-foreground hover:text-foreground"
              >
                Today
              </Button>
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => goToMonth(shiftMonth(month, -1))}
                className="group flex h-9 w-9 items-center justify-center rounded-lg border border-border/70 bg-surface text-muted-foreground hover:border-accent/30 hover:bg-surface-raised hover:text-foreground active:scale-95"
              >
                <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
              </button>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => goToMonth(shiftMonth(month, 1))}
                className="group flex h-9 w-9 items-center justify-center rounded-lg border border-border/70 bg-surface text-muted-foreground hover:border-accent/30 hover:bg-surface-raised hover:text-foreground active:scale-95"
              >
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
              </div>
            }
          />

          {/* Weekday headers */}
          <div className="grid grid-cols-7 text-center">
            {WEEKDAY_HEADERS.map((wd) => (
              <MonoLabel as="span" key={wd} className="pb-2">
                {wd}
              </MonoLabel>
            ))}
          </div>

          {/* Day cells — fixed 6 rows */}
          <div className="grid grid-cols-7 gap-1">
            {grid.map((cell) => {
              const items = cell.inMonth ? itemsByDate.get(cell.date) : undefined;
              const isSelected = cell.date === selected;
              const isToday = cell.date === today;
              return (
                <button
                  key={cell.date}
                  type="button"
                  disabled={!cell.inMonth}
                  onClick={() => setSelected(cell.date)}
                  aria-label={cell.date}
                  aria-pressed={isSelected}
                  className={cn(
                    "flex h-11 flex-col items-center justify-center gap-1 rounded-lg text-sm tabular-nums sm:h-14",
                    !cell.inMonth && "text-muted-foreground/25",
                    cell.inMonth &&
                      !isSelected &&
                      "text-foreground hover:bg-surface-raised active:scale-95",
                    isSelected &&
                      "bg-accent-gradient font-semibold text-accent-foreground shadow-glow-accent-sm",
                    isToday &&
                      !isSelected &&
                      "border border-accent/60 font-semibold shadow-glow-accent-sm ring-1 ring-inset ring-accent/30"
                  )}
                >
                  {cell.dayOfMonth}
                  {/* Indicators: orientation only — detail lives in the panel */}
                  <span className="flex h-1.5 items-center gap-1" aria-hidden>
                    {items && items.taskCount > 0 && (
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          isSelected ? "bg-accent-foreground/80" : "bg-accent"
                        )}
                      />
                    )}
                    {items && items.reminderCount > 0 && (
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          isSelected ? "bg-accent-foreground/60" : "bg-warning"
                        )}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="mt-4 flex items-center gap-4 border-t border-border/60 pt-4 text-xs text-muted-foreground/60">
            <span className="flex items-center gap-2">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
              Tasks
            </span>
            <span className="flex items-center gap-2">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warning" />
              Reminders
            </span>
          </div>
        </div>

        {/* Day details — a LIST panel, so it carries NO padding of its own.
            Padding the card and the row both inset the title twice and cost
            it 34px, which truncated a real 42-character task title at 375.
            The rows span the card edge to edge and own the 16 themselves;
            branches that are one object (skeleton, error) re-add it. */}
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          {isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          ) : isError ? (
            <div className="p-4">
              <EmptyState
                icon={AlertCircle}
                title="Couldn't load this month"
                description="Something went wrong fetching your schedule."
                action={
                  <Button variant="outline" onClick={() => refetch()}>
                    Try again
                  </Button>
                }
              />
            </div>
          ) : (
            <DayDetails
              date={selected}
              items={selectedItems}
              monthIsEmpty={monthIsEmpty}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Selected-day panel ──────────────────────────────────────────── */

function DayDetails({
  date,
  items,
  monthIsEmpty,
}: {
  date: string;
  items: CalendarDayItems | null;
  monthIsEmpty: boolean;
}) {
  const hasTasks = (items?.taskCount ?? 0) > 0;
  const hasReminders = (items?.reminderCount ?? 0) > 0;

  return (
    <div>
      {/* Everything that is NOT a row carries the 16 itself, because the
          panel no longer does. */}
      <h3 className="px-4 pt-4 text-sm font-semibold text-foreground">
        {dayLabel(date)}
      </h3>

      {!hasTasks && !hasReminders ? (
        <EmptyState
          icon={CalendarIcon}
          title="Nothing scheduled"
          description={
            monthIsEmpty
              ? "This month is wide open."
              : "No tasks or reminders on this day."
          }
          density="compact"
          className="m-4 border-none bg-transparent"
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
        // 16 between the two sibling groups inside this one panel.
        <div className="mt-4 space-y-4">
          {hasTasks && items && (
            <section>
              <MonoLabel className="mb-2 flex items-center gap-2 px-4">
                <CheckSquare className="h-3.5 w-3.5" />
                Tasks
              </MonoLabel>
              {/* divide-y ALONE — never `divide-y divide-border`, which resets
                  border-color on every child after the first. */}
              <ul className="divide-y border-y">
                {items.tasks.map((task) => (
                  <li
                    key={task.id}
                    className="flex items-center gap-2 p-4"
                  >
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-sm",
                        task.completed
                          ? "text-muted-foreground line-through"
                          : "text-foreground"
                      )}
                    >
                      {task.title}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium capitalize",
                        priorityStyles[task.priority]
                      )}
                    >
                      {task.priority}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {hasReminders && items && (
            <section>
              <MonoLabel className="mb-2 flex items-center gap-2 px-4">
                <Bell className="h-3.5 w-3.5" />
                Reminders
              </MonoLabel>
              <ul className="divide-y border-y">
                {items.reminders.map((reminder) => (
                  <li
                    key={reminder.id}
                    className={cn(
                      "flex items-center gap-2 p-4",
                      reminder.sent && "opacity-60"
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {reminder.title}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {istTime12h.format(new Date(reminder.scheduledAt))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex gap-4 px-4 pb-4">
            {hasTasks && (
              <Link
                href="/dashboard/tasks"
                className="text-xs font-medium text-accent hover:text-accent-hover"
              >
                View tasks →
              </Link>
            )}
            {hasReminders && (
              <Link
                href="/dashboard/reminders"
                className="text-xs font-medium text-accent hover:text-accent-hover"
              >
                View reminders →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
