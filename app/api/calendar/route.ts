import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { istDateString } from "@/lib/date";
import type { TaskPriority } from "@/types/database";

export interface CalendarTask {
  id: string;
  title: string;
  completed: boolean;
  priority: TaskPriority;
}

export interface CalendarReminder {
  id: string;
  title: string;
  scheduledAt: string; // ISO instant (remind_at)
  sent: boolean;
}

export interface CalendarDayItems {
  date: string; // YYYY-MM-DD (IST civil date)
  tasks: CalendarTask[];
  reminders: CalendarReminder[];
  taskCount: number;
  reminderCount: number;
}

export interface CalendarMonthData {
  month: string; // "YYYY-MM"
  days: CalendarDayItems[]; // sparse — only days that have items
}

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// GET /api/calendar?month=YYYY-MM — tasks (by due_date) and reminders
// (by remind_at) grouped onto IST civil dates for one month.
export async function GET(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  const { searchParams } = new URL(request.url);
  const month =
    searchParams.get("month") ?? istDateString().slice(0, 7);
  if (!MONTH_RE.test(month)) {
    return json({ data: null, error: "Invalid month (expected YYYY-MM)" }, 400);
  }

  // Month window as IST instants: [1st 00:00 IST, 1st of next month 00:00 IST)
  const [y, m] = month.split("-").map((n) => parseInt(n, 10));
  const startIso = new Date(`${month}-01T00:00:00.000+05:30`).toISOString();
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const endIso = new Date(`${nextMonth}-01T00:00:00.000+05:30`).toISOString();

  const [tasksRes, remindersRes] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, status, priority, due_date")
      .gte("due_date", startIso)
      .lt("due_date", endIso)
      .order("due_date", { ascending: true }),
    supabase
      .from("reminders")
      .select("id, title, remind_at, is_sent")
      .gte("remind_at", startIso)
      .lt("remind_at", endIso)
      .order("remind_at", { ascending: true }),
  ]);

  const firstError = tasksRes.error ?? remindersRes.error;
  if (firstError) return json({ data: null, error: firstError.message }, 500);

  const byDate = new Map<string, CalendarDayItems>();
  const dayFor = (date: string): CalendarDayItems => {
    let day = byDate.get(date);
    if (!day) {
      day = { date, tasks: [], reminders: [], taskCount: 0, reminderCount: 0 };
      byDate.set(date, day);
    }
    return day;
  };

  for (const t of tasksRes.data ?? []) {
    if (!t.due_date) continue;
    const day = dayFor(istDateString(Date.parse(t.due_date)));
    day.tasks.push({
      id: t.id,
      title: t.title,
      completed: t.status === "done",
      priority: t.priority,
    });
    day.taskCount += 1;
  }
  for (const r of remindersRes.data ?? []) {
    const day = dayFor(istDateString(Date.parse(r.remind_at)));
    day.reminders.push({
      id: r.id,
      title: r.title,
      scheduledAt: r.remind_at,
      sent: r.is_sent,
    });
    day.reminderCount += 1;
  }

  const data: CalendarMonthData = {
    month,
    days: Array.from(byDate.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    ),
  };
  return json<CalendarMonthData>({ data, error: null });
}
