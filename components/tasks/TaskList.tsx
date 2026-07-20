import type { Task } from "@/types/database";
import { groupRecurringBacklog } from "./group-backlog";
import { TaskCard } from "./TaskCard";

/** Presentational grid of task cards (single column on mobile, 2 on wide).
 *  Open instances of the same recurring template are consolidated into one
 *  card with a catch-up backlog — see group-backlog.ts. */
export function TaskList({ tasks }: { tasks: Task[] }) {
  return (
    <div className="stagger-children grid grid-cols-1 gap-2 md:gap-4 lg:grid-cols-2">
      {groupRecurringBacklog(tasks).map(({ task, backlog }) => (
        <TaskCard key={task.id} task={task} backlog={backlog} />
      ))}
    </div>
  );
}
