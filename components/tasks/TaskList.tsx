import type { Task } from "@/types/database";
import { TaskCard } from "./TaskCard";

/** Presentational grid of task cards (single column on mobile, 2 on wide). */
export function TaskList({ tasks }: { tasks: Task[] }) {
  return (
    <div className="stagger-children grid grid-cols-1 gap-2 md:gap-4 lg:grid-cols-2">
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} />
      ))}
    </div>
  );
}
