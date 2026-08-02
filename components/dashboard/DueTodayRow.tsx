"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Repeat } from "lucide-react";

import { cn } from "@/lib/utils";
import { hapticTap } from "@/lib/haptics";
import { useUpdateTask } from "@/hooks/useTasks";
import type { Task } from "@/types/database";
import {
  priorityBorder,
  priorityStyles,
  statusStyles,
  statusLabel,
} from "@/components/tasks/task-styles";
import { DashboardRow, ROW_BUBBLE } from "@/components/dashboard/DashboardRow";

/**
 * A single "Due Today" row. The dashboard page is a Server Component, so
 * interactivity lives here in a "use client" island (mirrors the MoodWidget
 * pattern). The mark-done button is the row's leading control and is rendered
 * as a SIBLING of the link by DashboardRow — never nested inside it — so a tap
 * on the button can't also navigate, and the markup stays valid.
 *
 * `dueLabel` is computed server-side via formatDueDate so the IST due-date
 * logic isn't duplicated on the client.
 */
export function DueTodayRow({
  task,
  dueLabel,
}: {
  task: Task;
  dueLabel: string | null;
}) {
  const router = useRouter();
  const updateTask = useUpdateTask();

  // Optimistic check: show the row as done the instant it's tapped, before the
  // server refresh lands. The authoritative state comes from router.refresh()
  // (the Due Today query excludes done tasks, so the row drops out on refresh).
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
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {dueLabel}
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
