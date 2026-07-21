"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  MoreHorizontal,
  Pencil,
  Repeat,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  formatDueDate,
  istDayLabel,
  istDayNumber,
  type DueTone,
} from "@/lib/date";
import { useUIStore } from "@/store/ui.store";
import { useUpdateTask, useDeleteTask } from "@/hooks/useTasks";
import type { Task } from "@/types/database";
import {
  priorityStyles,
  priorityBorder,
  statusStyles,
  statusLabel,
  nextStatus,
} from "./task-styles";
import { DayRail } from "@/components/shared/DayRail";
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

const SWIPE_THRESHOLD = 80; // px to trigger an action
const SWIPE_MAX = 120; // px clamp so the card doesn't fly off

export function TaskCard({
  task,
  backlog = [],
}: {
  task: Task;
  /** Older open instances of the same recurring template (oldest first) —
   *  shown as a collapsed "N days behind" catch-up list. All primary card
   *  actions (swipe, status, menu) act on `task` ONLY; each backlog day is
   *  completed individually so the per-day history stays truthful. */
  backlog?: Task[];
}) {
  const openEditTask = useUIStore((s) => s.openEditTask);
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const [showBacklog, setShowBacklog] = useState(false);

  const due = formatDueDate(task.due_date);
  const isDone = task.status === "done";
  // Whole IST days from the OLDEST open instance to today — how far behind
  // this template is (backlog rows always carry a due_date; guard anyway).
  const oldestDue = backlog[0]?.due_date;
  const daysBehind = oldestDue
    ? istDayNumber(Date.now()) - istDayNumber(Date.parse(oldestDue))
    : 0;

  // --- Swipe gesture (touch only): right = done, left = delete w/ undo ---
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const horizontal = useRef(false);

  function queueDelete() {
    const timeout = setTimeout(() => deleteTask.mutate(task.id), 5000);
    toast(
      (t) => (
        <span className="flex items-center gap-3 text-sm">
          Deleting &ldquo;{task.title.slice(0, 24)}
          {task.title.length > 24 ? "…" : ""}&rdquo;
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
    // Lock into horizontal mode only with clear sideways intent, so vertical
    // page scrolling stays untouched.
    if (!horizontal.current) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        horizontal.current = true;
      } else {
        return;
      }
    }
    setDragX(Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, dx)));
  }

  function onTouchEnd() {
    setDragging(false);
    if (horizontal.current) {
      if (dragX > SWIPE_THRESHOLD && !isDone) {
        updateTask.mutate({ id: task.id, status: "done" });
      } else if (dragX < -SWIPE_THRESHOLD) {
        queueDelete();
      }
    }
    setDragX(0);
    touchStart.current = null;
    horizontal.current = false;
  }

  return (
    <div className="relative">
      {/* Reveal layer behind the card while swiping */}
      {dragX !== 0 && (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center rounded-r-xl px-5",
            dragX > 0
              ? "justify-start bg-success/15 text-success"
              : "justify-end bg-danger/15 text-danger"
          )}
        >
          {dragX > 0 ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : (
            <Trash2 className="h-5 w-5" />
          )}
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
          "group cursor-default rounded-l-none rounded-r-xl border border-l-2 border-border bg-surface p-4 hover:border-accent/25 active:scale-[0.99] active:opacity-90",
          dragging && "no-transition",
          priorityBorder[task.priority]
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-1.5">
            <Link
              href={`/dashboard/tasks/${task.id}`}
              className={cn(
                "line-clamp-2 text-sm font-medium text-foreground hover:text-accent",
                isDone && "text-muted-foreground line-through"
              )}
            >
              {task.title}
            </Link>
            {task.recurring_task_id && (
              <Repeat
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-label="Repeats daily"
              />
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Task actions"
                className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground opacity-60 transition hover:bg-surface-raised hover:text-foreground group-hover:opacity-100"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() =>
                  updateTask.mutate({
                    id: task.id,
                    status: isDone ? "todo" : "done",
                  })
                }
              >
                {isDone ? (
                  <Circle className="mr-2 h-4 w-4" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                {isDone ? "Mark as todo" : "Mark as done"}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => openEditTask(task)}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              {task.recurring_task_id && (
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => {
                    // stop_recurring rides on the PATCH body (assigned to a var
                    // so it stays assignable to UpdateTaskInput). The API flips
                    // the template's is_active; today's/past instances remain.
                    const stopPayload = { id: task.id, stop_recurring: true };
                    updateTask.mutate(stopPayload, {
                      onSuccess: () =>
                        toast.success("Won't repeat after today"),
                    });
                  }}
                >
                  <Repeat className="mr-2 h-4 w-4" />
                  Stop repeating
                </DropdownMenuItem>
              )}
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
              updateTask.mutate({
                id: task.id,
                status: nextStatus[task.status],
              })
            }
            className={cn(
              "cursor-pointer rounded-full px-2 py-0.5 text-xs font-medium hover:opacity-90 active:scale-95",
              statusStyles[task.status]
            )}
            title="Click to change status"
          >
            {statusLabel[task.status]}
          </button>

          {daysBehind > 0 && (
            <button
              type="button"
              onClick={() => setShowBacklog((v) => !v)}
              aria-expanded={showBacklog}
              className="flex items-center gap-2 rounded-full border border-warning/30 bg-warning/10 py-1 pl-2 pr-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.04em] text-warning transition hover:bg-warning/15 active:scale-95"
            >
              <DayRail
                days={[
                  ...Array.from({ length: Math.min(daysBehind, 7) }, () => ({
                    filled: true,
                  })),
                  { filled: false, isToday: true },
                ]}
                fillClassName="bg-warning"
                outlineClassName="border-accent"
              />
              {daysBehind} day{daysBehind === 1 ? "" : "s"} behind
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform",
                  showBacklog && "rotate-180"
                )}
              />
            </button>
          )}

          {isDone
            ? task.completed_at && (
                <span className="ml-auto text-xs text-muted-foreground">
                  Completed
                </span>
              )
            : due && (
                <span
                  className={cn(
                    "ml-auto flex items-center gap-1.5 font-mono text-xs tabular-nums",
                    dueToneClass[due.tone],
                    due.bold && "font-semibold"
                  )}
                >
                  {due.tone === "danger" && (
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 rounded-full bg-danger"
                    />
                  )}
                  {due.label}
                </span>
              )}
        </div>

        {showBacklog && backlog.length > 0 && (
          <div className="mt-3 border-t border-border pt-2.5">
            <p className="text-[11px] text-muted-foreground">
              Missed days — each is marked done individually
            </p>
            <ul className="mt-1">
              {backlog.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center gap-2 border-b border-border py-1 text-xs last:border-b-0"
                >
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {b.due_date ? istDayLabel(b.due_date) : "No date"}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      updateTask.mutate({ id: b.id, status: "done" })
                    }
                    disabled={updateTask.isPending}
                    aria-label={`Mark ${
                      b.due_date ? istDayLabel(b.due_date) : "this day"
                    } done`}
                    className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 font-semibold text-accent transition hover:bg-accent/10 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Mark done
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
