"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Repeat } from "lucide-react";

import { cn } from "@/lib/utils";
import { useUpdateTask } from "@/hooks/useTasks";
import type { Task } from "@/types/database";
import {
  priorityStyles,
  statusStyles,
  statusLabel,
} from "@/components/tasks/task-styles";

/**
 * A single "Due Today" row on the dashboard. The dashboard page is a Server
 * Component, so interactivity lives here in a "use client" island (mirrors the
 * MoodWidget pattern). The mark-done button is a SIBLING of the <Link> — never
 * nested inside it — so a tap on the button can't also trigger navigation and
 * we avoid the invalid interactive-inside-<a> markup.
 *
 * `dueLabel` is computed server-side via formatDueDate and passed in so the
 * IST due-date logic isn't duplicated on the client.
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
    <li className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
      <button
        type="button"
        onClick={markDone}
        disabled={done || updateTask.isPending}
        aria-label={done ? `${task.title} marked done` : `Mark "${task.title}" done`}
        className={cn(
          "shrink-0 rounded-full text-muted-foreground transition-colors hover:text-accent",
          done && "text-accent"
        )}
      >
        {done ? (
          <CheckCircle2 className="h-5 w-5" />
        ) : (
          <Circle className="h-5 w-5" />
        )}
      </button>

      <Link
        href={`/dashboard/tasks/${task.id}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "min-w-0 truncate text-sm font-medium text-foreground",
              done && "text-muted-foreground line-through"
            )}
          >
            {task.title}
          </span>
          {task.recurring_task_id && (
            <Repeat
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-label="Repeats daily"
            />
          )}
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
        </div>
        {dueLabel && (
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {dueLabel}
          </span>
        )}
      </Link>
    </li>
  );
}
