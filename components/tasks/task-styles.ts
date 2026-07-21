import type { TaskPriority, TaskStatus } from "@/types/database";

/* Flat semantic washes per the design system: Amber = time/priority pressure,
   Signal = high priority, graphite for low. Gradients and glows are retired. */
export const priorityStyles: Record<TaskPriority, string> = {
  low: "bg-surface-raised text-muted-foreground border border-border",
  medium: "bg-warning/10 text-warning border border-warning/25",
  high: "bg-danger/10 text-danger border border-danger/25",
};

/**
 * Left accent border per priority — instantly scannable on task cards.
 * hover: variants re-assert the color so the card's hover:border-* (which sets
 * all four sides) doesn't wash out the accent.
 */
export const priorityBorder: Record<TaskPriority, string> = {
  low: "border-l-border-col hover:border-l-border-col",
  medium: "border-l-warning hover:border-l-warning",
  high: "border-l-danger hover:border-l-danger",
};

export const statusStyles: Record<TaskStatus, string> = {
  todo: "bg-muted text-muted-foreground",
  in_progress: "bg-accent/15 text-accent",
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
