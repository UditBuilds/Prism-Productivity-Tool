"use client";

import { useRef, useState } from "react";
import toast from "react-hot-toast";
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

const SWIPE_THRESHOLD = 80; // px to trigger delete
const SWIPE_MAX = 120; // px clamp so the card doesn't fly off

export function ReminderCard({ reminder }: { reminder: Reminder }) {
  const openEditReminder = useUIStore((s) => s.openEditReminder);
  const deleteReminder = useDeleteReminder();
  const { data: tasks } = useTasksQuery();
  const { data: notes } = useNotesQuery();

  const when = formatReminderTime(reminder.remind_at);

  // --- Trailing swipe (touch only): left = delete with 5s undo, same
  // gesture/undo pattern as TaskCard. Right swipe is intentionally inert.
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const horizontal = useRef(false);

  function queueDelete() {
    const timeout = setTimeout(() => deleteReminder.mutate(reminder.id), 5000);
    toast(
      (t) => (
        <span className="flex items-center gap-3 text-sm">
          Deleting &ldquo;{reminder.title.slice(0, 24)}
          {reminder.title.length > 24 ? "…" : ""}&rdquo;
          <button
            type="button"
            className="font-semibold text-accent"
            onClick={() => {
              clearTimeout(timeout);
              toast.dismiss(t.id);
            }}
          >
            Undo
          </button>
        </span>
      ),
      { duration: 5000, icon: "🗑️" }
    );
  }

  function onTouchStart(e: React.TouchEvent) {
    touchStart.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
    horizontal.current = false;
    setDragging(true);
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!touchStart.current) return;
    const dx = e.touches[0].clientX - touchStart.current.x;
    const dy = e.touches[0].clientY - touchStart.current.y;
    // Horizontal-intent lock keeps vertical page scrolling untouched.
    if (!horizontal.current) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        horizontal.current = true;
      } else {
        return;
      }
    }
    setDragX(Math.max(-SWIPE_MAX, Math.min(0, dx)));
  }

  function onTouchEnd() {
    setDragging(false);
    if (horizontal.current && dragX < -SWIPE_THRESHOLD) {
      queueDelete();
    }
    setDragX(0);
    touchStart.current = null;
    horizontal.current = false;
  }

  const linkedTask = reminder.task_id
    ? tasks?.find((t) => t.id === reminder.task_id)
    : undefined;
  const linkedNote = reminder.note_id
    ? notes?.find((n) => n.id === reminder.note_id)
    : undefined;

  // Time-based coloring: overdue pending = red pulse, due soon = accent glow,
  // far future / sent = calm default.
  const pending = !reminder.is_sent;
  const urgent = pending && when.tone === "danger";
  const soon = pending && when.tone === "warning";

  return (
    <div className="relative">
      {/* Reveal layer behind the card while swiping left */}
      {dragX !== 0 && (
        <div
          aria-hidden
          className="absolute inset-0 flex items-center justify-end rounded-xl bg-gradient-to-l from-danger/30 via-danger/15 to-transparent px-5 text-danger"
        >
          <Trash2 className="h-5 w-5" />
        </div>
      )}

      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          transform: dragX !== 0 ? `translateX(${dragX}px)` : undefined,
          touchAction: "pan-y",
        }}
        className={cn(
          "group flex items-start gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent/25",
          dragging && "no-transition",
          urgent && "border-danger/30",
          soon && "border-accent/25 shadow-glow-accent-sm"
        )}
      >
      <div
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          urgent
            ? "animate-pulse bg-danger/15 text-danger"
            : "bg-accent/15 text-accent"
        )}
      >
        <Bell
          className={cn("h-4 w-4", (urgent || soon) && "animate-bell-ring-loop")}
        />
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
    </div>
  );
}
