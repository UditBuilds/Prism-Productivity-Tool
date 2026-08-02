import { ListTodo, Repeat } from "lucide-react";

import type { Task } from "@/types/database";
import { priorityBorder, priorityStyles } from "@/components/tasks/task-styles";
import { DashboardRow } from "@/components/dashboard/DashboardRow";

/**
 * A future-dated task inside the dashboard's "Upcoming" list.
 *
 * Presentational and server-rendered — no "use client". Unlike DueTodayRow
 * there is no mark-done affordance: a task that isn't due yet shouldn't invite
 * completion from the dashboard, and keeping this a Server Component avoids
 * shipping another client island.
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
    <DashboardRow
      accentBorder={priorityBorder[task.priority]}
      leading={<ListTodo className="h-4 w-4 text-muted-foreground" />}
      href={`/dashboard/tasks/${task.id}`}
      title={task.title}
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
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium capitalize ${priorityStyles[task.priority]}`}
        >
          {task.priority}
        </span>
      }
    />
  );
}
