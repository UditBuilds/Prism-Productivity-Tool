import Link from "next/link";
import { ListTodo, Repeat } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Task } from "@/types/database";
import { priorityBorder, priorityStyles } from "@/components/tasks/task-styles";

/**
 * A future-dated task inside the dashboard's "Upcoming" list.
 *
 * Presentational and server-rendered — no "use client". Unlike DueTodayRow
 * there is no mark-done affordance: a task that isn't due yet shouldn't invite
 * completion from the dashboard, and keeping this a Server Component avoids
 * shipping another client island.
 *
 * The priority left-border is the same accent TaskCard uses, which is what
 * distinguishes a task row from the emoji countdown and bell reminder rows
 * beside it.
 *
 * `dueLabel` is computed server-side by formatDueDate so the IST day math
 * lives in exactly one place.
 */
export function UpcomingTaskRow({
  task,
  dueLabel,
}: {
  task: Task;
  dueLabel: string | null;
}) {
  return (
    <li
      className={cn(
        "border-l-2 transition-colors",
        "rounded-xl border border-border bg-surface hover:border-accent/25",
        priorityBorder[task.priority]
      )}
    >
      <Link href={`/dashboard/tasks/${task.id}`} className="flex items-center gap-3 px-4 py-3">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-raised"
        >
          <ListTodo className="h-4 w-4 text-muted-foreground" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">
              {task.title}
            </span>
            {task.recurring_task_id && (
              <Repeat
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-label="Repeats daily"
              />
            )}
          </div>
          {dueLabel && (
            <p className="mt-0.5 truncate font-mono text-xs tabular-nums text-muted-foreground">
              {dueLabel}
            </p>
          )}
        </div>

        <span
          className={cn(
            "shrink-0 rounded-md px-2 py-0.5 text-xs font-medium capitalize",
            priorityStyles[task.priority]
          )}
        >
          {task.priority}
        </span>
      </Link>
    </li>
  );
}
