import Link from "next/link";
import { CalendarClock, CheckCircle2, Brain, Bell, Coffee, AlertCircle } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { istDayContext, greetingForHour } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/database";
import {
  priorityStyles,
  statusStyles,
  statusLabel,
} from "@/components/tasks/task-styles";

export const metadata = { title: "Dashboard | Prism" };

export default async function DashboardHome() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // layout already redirects unauthenticated users

  const { startOfToday, endOfToday, startOfWeek, hour } = istDayContext();
  const nowIso = new Date().toISOString();

  const [profileRes, dueRes, completedRes, cardsRes, remindersRes] =
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
    ]);

  const displayName = profileRes.data?.display_name ?? "there";
  const dueTasks: Task[] = dueRes.data ?? [];
  const dueCount = dueRes.count ?? 0;
  const dueError = dueRes.error?.message ?? null;
  const completedCount = completedRes.count ?? 0;
  const cardsCount = cardsRes.count ?? 0;
  const remindersTodayCount = remindersRes.count ?? 0;

  const stats = [
    {
      label: "Due Today",
      value: dueCount,
      icon: CalendarClock,
      accent: "border-t-warning/70",
    },
    {
      label: "Completed",
      value: completedCount,
      icon: CheckCircle2,
      accent: "border-t-success/70",
    },
    {
      label: "Cards to Review",
      value: cardsCount,
      icon: Brain,
      accent: "border-t-violet-500/70",
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
      {/* Greeting */}
      <header>
        <h1 className="text-2xl font-semibold text-foreground">
          {greetingForHour(hour)},{" "}
          <span className="font-bold text-violet-400">{displayName}</span>
        </h1>
      </header>

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
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-widest text-[#666]">
                {label}
              </span>
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            </div>
            <p className="mt-3 text-2xl font-bold text-white lg:text-3xl">
              {value}
            </p>
          </div>
        ))}
      </section>

      {/* Due Today */}
      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2 border-l-2 border-violet-500 pl-3">
          <h2 className="text-base font-semibold text-foreground">Due Today</h2>
        </div>

        {dueError ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
            <AlertCircle className="h-8 w-8 text-danger" />
            <p className="mt-3 text-sm text-muted-foreground">
              Couldn&apos;t load today&apos;s tasks. Try refreshing.
            </p>
          </div>
        ) : dueTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
            <Coffee className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Nothing due today. Good day to get ahead.
            </p>
          </div>
        ) : (
          <>
            <ul className="space-y-2">
              {dueTasks.map((task) => (
                <li key={task.id}>
                  <Link
                    href={`/dashboard/tasks/${task.id}`}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 transition hover:bg-[#111]"
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
            <div className="mt-2 text-right">
              <Link
                href="/dashboard/tasks"
                className="text-xs text-violet-400 hover:text-violet-300"
              >
                View all →
              </Link>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
