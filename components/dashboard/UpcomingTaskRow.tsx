import { Circle, Repeat } from "lucide-react";

import type { Task } from "@/types/database";
import { priorityBorder, priorityStyles } from "@/components/tasks/task-styles";
import { DashboardRow } from "@/components/dashboard/DashboardRow";

/**
 * A future-dated task inside the dashboard's agenda.
 *
 * Presentational and server-rendered — no "use client". Unlike AgendaTaskRow
 * there is no mark-done affordance: a task that isn't due yet shouldn't invite
 * completion from the dashboard, and keeping this a Server Component avoids
 * shipping another client island.
 *
 * SAME ANATOMY AS AgendaTaskRow, deliberately. It used to lead with a ListTodo
 * glyph while the row above it led with an empty circle, so a single list read
 * as two kinds of thing. Both now lead with the same circle in the same bubble,
 * carry the recurring marker on the meta line, and end in one priority badge.
 *
 * The circle here is not a button — but it is inside the row's Link, so tapping
 * it opens the task, where it can be completed. That is a useful destination
 * rather than a dead target, which is why the glyph can be shared without also
 * sharing the mark-done behaviour.
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
      leading={<Circle className="h-5 w-5 text-muted-foreground" />}
      href={`/dashboard/tasks/${task.id}`}
      title={task.title}
      meta={
        dueLabel || task.recurring_task_id ? (
          <span className="flex items-center gap-2">
            {task.recurring_task_id && (
              <Repeat
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-label="Repeats daily"
              />
            )}
            {dueLabel && (
              <span className="truncate font-mono text-xs tabular-nums text-muted-foreground">
                {dueLabel}
              </span>
            )}
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
