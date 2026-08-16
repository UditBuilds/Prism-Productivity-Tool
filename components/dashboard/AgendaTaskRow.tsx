"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Repeat } from "lucide-react";

import { cn } from "@/lib/utils";
import { hapticTap } from "@/lib/haptics";
import { useUpdateTask } from "@/hooks/useTasks";
import type { DueTone } from "@/lib/date";
import type { Task } from "@/types/database";
import {
  priorityBorder,
  priorityStyles,
  statusStyles,
  statusLabel,
} from "@/components/tasks/task-styles";
import { DashboardRow, ROW_BUBBLE } from "@/components/dashboard/DashboardRow";

/** Meta tint per due tone. Overdue is the only one that raises its voice. */
const TONE_CLASS: Record<DueTone, string> = {
  danger: "text-danger font-medium",
  warning: "text-warning",
  muted: "text-muted-foreground",
};

/**
 * A task row in the dashboard's agenda — overdue or due today.
 *
 * Was DueTodayRow. It now also carries overdue rows, which is the whole point
 * of this rebuild: a task that went past its date used to match no query on
 * this page and simply vanished, so the dashboard said "all clear" while work
 * was slipping.
 *
 * Future-dated tasks keep the separate, static UpcomingTaskRow — mark-done is
 * offered for work that is OWED (overdue, today) and withheld for work that
 * isn't yet, which is the existing decision, not a new one.
 *
 * `backlogCount` is the consolidation from components/tasks/group-backlog.ts:
 * the cron spawns one row per scheduled day, so an uncompleted recurring
 * template accumulates near-identical siblings daily. They collapse into this
 * one row rather than filling the list with the same title N times. Actions
 * here complete ONLY the fronting instance — the sibling rows are never
 * merged, hidden or altered, because per-day history is what analytics read.
 *
 * `dueLabel`/`dueTone` are computed server-side by formatDueDate so the IST
 * day math lives in exactly one place.
 */
export function AgendaTaskRow({
  task,
  dueLabel,
  dueTone = "muted",
  backlogCount = 0,
}: {
  task: Task;
  dueLabel: string | null;
  dueTone?: DueTone;
  backlogCount?: number;
}) {
  const router = useRouter();
  const updateTask = useUpdateTask();

  // Optimistic check: show the row as done the instant it's tapped, before the
  // server refresh lands. The authoritative state comes from router.refresh()
  // (the agenda queries exclude done tasks, so the row drops out on refresh).
  const [optimisticDone, setOptimisticDone] = useState(false);
  const done = task.status === "done" || optimisticDone;

  function markDone() {
    if (done || updateTask.isPending) return;
    hapticTap();
    setOptimisticDone(true);
    // Send ONLY status — the API route stamps completed_at server-side.
    updateTask.mutate(
      { id: task.id, status: "done" },
      {
        onSuccess: () => router.refresh(),
        onError: () => setOptimisticDone(false),
      }
    );
  }

  return (
    <DashboardRow
      className={cn(done && "border-success/30 bg-success/[0.04]")}
      accentBorder={priorityBorder[task.priority]}
      leadingInteractive
      leading={
        <button
          type="button"
          onClick={markDone}
          disabled={done || updateTask.isPending}
          aria-label={
            done ? `${task.title} marked done` : `Mark "${task.title}" done`
          }
          className={cn(
            ROW_BUBBLE,
            "text-muted-foreground transition-colors hover:text-accent",
            done && "text-success"
          )}
        >
          {done ? (
            <CheckCircle2 className="h-5 w-5 animate-pop" />
          ) : (
            <Circle className="h-5 w-5" />
          )}
        </button>
      }
      href={`/dashboard/tasks/${task.id}`}
      title={
        <span className={cn(done && "text-muted-foreground line-through")}>
          {task.title}
        </span>
      }
      titleAdornment={
        task.recurring_task_id ? (
          <Repeat
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-label="Repeats daily"
          />
        ) : null
      }
      meta={
        dueLabel ? (
          <span
            className={cn(
              "font-mono text-xs tabular-nums",
              TONE_CLASS[dueTone]
            )}
          >
            {dueLabel}
            {backlogCount > 0 && (
              <span className="text-muted-foreground">
                {" "}
                · +{backlogCount} earlier
              </span>
            )}
          </span>
        ) : null
      }
      trailing={
        <>
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
        </>
      }
    />
  );
}
