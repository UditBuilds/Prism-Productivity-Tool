import type { TaskPriority, TaskStatus } from "@/types/database";

export const priorityStyles: Record<TaskPriority, string> = {
  low: "bg-gradient-to-r from-gray-800 to-gray-700 text-gray-400 border border-gray-700/50",
  medium:
    "bg-gradient-to-r from-amber-900/40 to-amber-800/30 text-amber-400 border border-amber-700/30",
  high: "bg-gradient-to-r from-red-900/40 to-red-800/30 text-red-400 border border-red-700/30",
};

export const statusStyles: Record<TaskStatus, string> = {
  todo: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-500/15 text-blue-400",
  done: "bg-success/15 text-success",
};

export const statusLabel: Record<TaskStatus, string> = {
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
};

/** Click order for the status pill: todo → in_progress → done → todo. */
export const nextStatus: Record<TaskStatus, TaskStatus> = {
  todo: "in_progress",
  in_progress: "done",
  done: "todo",
};
