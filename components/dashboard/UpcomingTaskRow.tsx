import { Circle } from "lucide-react";

import type { Task } from "@/types/database";
import { priorityBorder, priorityText } from "@/components/tasks/task-styles";
import { DashboardRow, ROW_META } from "@/components/dashboard/DashboardRow";

/** The separator between meta segments. Muted so the segments rank, not it. */
function Dot() {
  return <span className="text-muted-foreground/40"> · </span>;
}

/**
 * A future-dated task inside the dashboard's agenda.
 *
 * Presentational and server-rendered — no "use client". Unlike AgendaTaskRow
 * there is no mark-done affordance: a task that isn't due yet shouldn't invite
 * completion from the dashboard, and keeping this a Server Component avoids
 * shipping another client island.
 *
 * SAME ANATOMY AS AgendaTaskRow, deliberately — same bare circle, same single
 * mono-caps meta line, same segment tints. The circle here is not a button, but
 * it sits inside the row's Link, so tapping it opens the task where it can be
 * completed. A useful destination rather than a dead target, which is what lets
 * the glyph be shared without also sharing the behaviour.
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
      leading={<Circle className="h-4 w-4 text-muted-foreground" />}
      href={`/dashboard/tasks/${task.id}`}
      title={task.title}
      meta={
        <span className={ROW_META}>
          {dueLabel && (
            <span className="text-muted-foreground">{dueLabel}</span>
          )}
          {dueLabel && <Dot />}
          <span className={priorityText[task.priority]}>{task.priority}</span>
          {task.recurring_task_id && (
            <>
              <Dot />
              <span className="text-muted-foreground">daily</span>
            </>
          )}
        </span>
      }
    />
  );
}
