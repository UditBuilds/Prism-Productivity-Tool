"use client";

import Link from "next/link";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDueDate, type DueTone } from "@/lib/date";
import { useUIStore } from "@/store/ui.store";
import { useUpdateTask, useDeleteTask } from "@/hooks/useTasks";
import type { Task } from "@/types/database";
import {
  priorityStyles,
  statusStyles,
  statusLabel,
  nextStatus,
} from "./task-styles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const dueToneClass: Record<DueTone, string> = {
  muted: "text-muted-foreground",
  warning: "text-warning",
  danger: "text-danger",
};

export function TaskCard({ task }: { task: Task }) {
  const openEditTask = useUIStore((s) => s.openEditTask);
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const due = formatDueDate(task.due_date);
  const isDone = task.status === "done";

  return (
    <div className="group cursor-default rounded-xl border border-[#1F1F1F] bg-[#111111] p-4 hover:-translate-y-0.5 hover:border-[#2A2A2A] hover:shadow-lg hover:shadow-black/30 active:scale-[0.98] active:opacity-90">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/dashboard/tasks/${task.id}`}
          className={cn(
            "line-clamp-2 text-sm font-medium text-foreground hover:text-accent",
            isDone && "text-muted-foreground line-through"
          )}
        >
          {task.title}
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Task actions"
              className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground opacity-60 transition hover:bg-surface-raised hover:text-foreground group-hover:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => openEditTask(task)}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer text-danger focus:text-danger"
              onClick={() => deleteTask.mutate(task.id)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-xs font-medium capitalize",
            priorityStyles[task.priority]
          )}
        >
          {task.priority}
        </span>

        <button
          type="button"
          onClick={() =>
            updateTask.mutate({ id: task.id, status: nextStatus[task.status] })
          }
          className={cn(
            "cursor-pointer rounded-full px-2 py-0.5 text-xs font-medium hover:opacity-90 active:scale-95",
            statusStyles[task.status]
          )}
          title="Click to change status"
        >
          {statusLabel[task.status]}
        </button>

        {due && (
          <span
            className={cn(
              "ml-auto flex items-center gap-1.5 text-xs",
              dueToneClass[due.tone],
              due.bold && "font-semibold"
            )}
          >
            {due.tone === "danger" && (
              <span
                aria-hidden
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger"
              />
            )}
            {due.label}
          </span>
        )}
      </div>
    </div>
  );
}
