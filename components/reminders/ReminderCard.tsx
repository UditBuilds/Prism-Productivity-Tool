"use client";

import {
  Bell,
  CheckSquare,
  FileText,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatReminderTime, type DueTone } from "@/lib/date";
import { useUIStore } from "@/store/ui.store";
import { useDeleteReminder } from "@/hooks/useReminders";
import { useTasksQuery } from "@/hooks/useTasks";
import { useNotesQuery } from "@/hooks/useNotes";
import type { Reminder } from "@/types/database";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const toneClass: Record<DueTone, string> = {
  muted: "text-muted-foreground",
  warning: "text-warning",
  danger: "text-danger",
};

export function ReminderCard({ reminder }: { reminder: Reminder }) {
  const openEditReminder = useUIStore((s) => s.openEditReminder);
  const deleteReminder = useDeleteReminder();
  const { data: tasks } = useTasksQuery();
  const { data: notes } = useNotesQuery();

  const when = formatReminderTime(reminder.remind_at);

  const linkedTask = reminder.task_id
    ? tasks?.find((t) => t.id === reminder.task_id)
    : undefined;
  const linkedNote = reminder.note_id
    ? notes?.find((n) => n.id === reminder.note_id)
    : undefined;

  return (
    <div className="group flex items-start gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-muted-foreground/40">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
        <Bell className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => openEditReminder(reminder)}
            className="line-clamp-2 text-left text-sm font-medium text-foreground hover:text-accent"
          >
            {reminder.title}
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Reminder actions"
                className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground opacity-60 transition hover:bg-surface-raised hover:text-foreground group-hover:opacity-100"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => openEditReminder(reminder)}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer text-danger focus:text-danger"
                onClick={() => deleteReminder.mutate(reminder.id)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {reminder.body && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {reminder.body}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "text-xs",
              toneClass[when.tone],
              when.bold && "font-semibold"
            )}
          >
            {when.label}
          </span>

          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              reminder.is_sent
                ? "bg-success/15 text-success"
                : "bg-muted text-muted-foreground"
            )}
          >
            {reminder.is_sent ? "Sent" : "Pending"}
          </span>

          {linkedTask && (
            <span className="inline-flex max-w-[12rem] items-center gap-1 rounded-md bg-surface-raised px-2 py-0.5 text-xs text-muted-foreground">
              <CheckSquare className="h-3 w-3 shrink-0" />
              <span className="truncate">{linkedTask.title}</span>
            </span>
          )}
          {linkedNote && (
            <span className="inline-flex max-w-[12rem] items-center gap-1 rounded-md bg-surface-raised px-2 py-0.5 text-xs text-muted-foreground">
              <FileText className="h-3 w-3 shrink-0" />
              <span className="truncate">{linkedNote.title}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
