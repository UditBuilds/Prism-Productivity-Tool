"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { CalendarIcon, Repeat, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui.store";
import { useCreateTask, useUpdateTask } from "@/hooks/useTasks";
import { usePlansQuery } from "@/hooks/usePlans";
import type { TaskPriority, TaskStatus } from "@/types/database";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

/** Pin a picked calendar date to 12:00 IST so it lands on the right IST day. */
function pickedDateToIso(d: Date): string {
  return new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 6, 30, 0)
  ).toISOString();
}

type RepeatPattern = "everyday" | "weekdays" | "weekends" | "custom";

const REPEAT_PATTERNS: { value: RepeatPattern; label: string }[] = [
  { value: "everyday", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekends", label: "Weekends" },
  { value: "custom", label: "Custom" },
];

// Weekday numbers: 0 = Sun … 6 = Sat (matches istWeekday + browser getDay()).
const PATTERN_DAYS: Record<Exclude<RepeatPattern, "custom">, number[]> = {
  everyday: [0, 1, 2, 3, 4, 5, 6],
  weekdays: [1, 2, 3, 4, 5],
  weekends: [0, 6],
};

const PATTERN_CAPTION: Record<RepeatPattern, string> = {
  everyday: "every day",
  weekdays: "weekdays",
  weekends: "weekends",
  custom: "selected days",
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Name of the next upcoming day (local time) whose weekday is in `days`.
 * Informational copy only — uses browser-local time, not IST. Called only when
 * today isn't a matching day, so the search starts one day ahead.
 */
function nextMatchingDayName(days: number[]): string {
  const now = new Date();
  for (let offset = 1; offset <= 7; offset++) {
    if (days.includes((now.getDay() + offset) % 7)) {
      const future = new Date(now);
      future.setDate(now.getDate() + offset);
      return future.toLocaleDateString(undefined, { weekday: "long" });
    }
  }
  return "the next matching day";
}

export function TaskForm() {
  const { taskDialogOpen, editingTask, closeTaskDialog } = useUIStore();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const { data: plans = [] } = usePlansQuery();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [planId, setPlanId] = useState<string | null>(null);
  const [repeatDaily, setRepeatDaily] = useState(false);
  const [repeatPattern, setRepeatPattern] = useState<RepeatPattern>("everyday");
  const [customDays, setCustomDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [titleError, setTitleError] = useState(false);

  // Hydrate the form whenever the dialog opens (create vs edit).
  useEffect(() => {
    if (!taskDialogOpen) return;
    setTitleError(false);
    setRepeatDaily(false); // create-only toggle; never carried into edit
    setRepeatPattern("everyday");
    setCustomDays([0, 1, 2, 3, 4, 5, 6]);
    if (editingTask) {
      setTitle(editingTask.title);
      setDescription(editingTask.description ?? "");
      setPriority(editingTask.priority);
      setStatus(editingTask.status);
      setDueDate(
        editingTask.due_date ? new Date(editingTask.due_date) : undefined
      );
      setPlanId(editingTask.plan_id);
    } else {
      setTitle("");
      setDescription("");
      setPriority("medium");
      setStatus("todo");
      setDueDate(undefined);
      setPlanId(null);
    }
  }, [taskDialogOpen, editingTask]);

  const selectedDays =
    repeatPattern === "custom" ? customDays : PATTERN_DAYS[repeatPattern];
  const createDisabled =
    !editingTask &&
    repeatDaily &&
    repeatPattern === "custom" &&
    customDays.length === 0;

  // Preview only — uses the browser's local weekday (no server round-trip).
  // The authoritative "starts today?" decision happens server-side.
  const repeatCaption = selectedDays.includes(new Date().getDay())
    ? `Starts today, repeats on ${PATTERN_CAPTION[repeatPattern]}`
    : `Repeats on ${PATTERN_CAPTION[repeatPattern]}, starts on the next matching day`;

  function toggleCustomDay(day: number) {
    setCustomDays((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : [...prev, day].sort((a, b) => a - b)
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError(true);
      return;
    }

    const payload = {
      title: trimmed,
      description: description.trim() || null,
      priority,
      status,
      due_date: dueDate ? pickedDateToIso(dueDate) : null,
      plan_id: planId,
    };

    if (editingTask) {
      updateTask.mutate({ id: editingTask.id, ...payload });
    } else {
      // repeat_daily rides along on the POST body; the API creates the
      // recurring template + today's instance. (Assigned to a var first so it's
      // structurally assignable to CreateTaskInput without an excess-prop error.)
      const createPayload = {
        ...payload,
        repeat_daily: repeatDaily,
        days_of_week: selectedDays,
      };
      createTask.mutate(createPayload, {
        onSuccess: (data) => {
          const instanceCreatedToday = (
            data as { instanceCreatedToday?: boolean }
          ).instanceCreatedToday;
          // A recurring task whose first instance is deferred to a later day:
          // replace the hook's generic "Task created" (which fires first) with a
          // message that explains why no task shows up today.
          if (instanceCreatedToday === false) {
            toast.dismiss();
            toast.success(
              `Recurring task created — first task on ${nextMatchingDayName(
                selectedDays
              )}`
            );
          }
        },
      });
    }
    closeTaskDialog();
  }

  return (
    <Dialog
      open={taskDialogOpen}
      onOpenChange={(open) => !open && closeTaskDialog()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editingTask ? "Edit task" : "New task"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError(false);
              }}
              placeholder="What needs doing?"
              autoFocus
              className="rounded-lg"
            />
            {titleError && (
              <p className="text-xs text-danger">Title is required.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-description">Description</Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details…"
              rows={3}
              className="rounded-lg"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as TaskPriority)}
              >
                <SelectTrigger className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editingTask && (
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as TaskStatus)}
                >
                  <SelectTrigger className="rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todo">Todo</SelectItem>
                    <SelectItem value="in_progress">In progress</SelectItem>
                    <SelectItem value="done">Done</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Due date</Label>
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "w-full justify-start rounded-lg font-normal",
                      !dueDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dueDate ? format(dueDate, "EEEE, d MMMM yyyy") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dueDate}
                    onSelect={setDueDate}
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
              {dueDate && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setDueDate(undefined)}
                  aria-label="Clear due date"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {plans.length > 0 && (
            <div className="space-y-2">
              <Label>Plan</Label>
              <Select
                value={planId ?? "none"}
                onValueChange={(v) => setPlanId(v === "none" ? null : v)}
              >
                <SelectTrigger className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No plan</SelectItem>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!editingTask ? (
            <div className="space-y-3">
              <button
                type="button"
                role="switch"
                aria-checked={repeatDaily}
                onClick={() => setRepeatDaily((v) => !v)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 transition",
                  repeatDaily
                    ? "border-accent/40 bg-accent/10"
                    : "border-border bg-surface hover:bg-surface-raised"
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Repeat className="h-4 w-4 text-muted-foreground" />
                  Repeat daily
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                    repeatDaily ? "bg-accent" : "border border-border bg-muted"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                      repeatDaily ? "translate-x-[18px]" : "translate-x-0.5"
                    )}
                  />
                </span>
              </button>

              {repeatDaily && (
                <div className="space-y-3 rounded-lg border border-border bg-surface-raised/40 p-3">
                  <div className="flex flex-wrap gap-2">
                    {REPEAT_PATTERNS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        aria-pressed={repeatPattern === p.value}
                        onClick={() => setRepeatPattern(p.value)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-medium transition",
                          repeatPattern === p.value
                            ? "border-accent bg-accent/15 text-accent"
                            : "border-border text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {repeatPattern === "custom" && (
                    <div className="flex flex-wrap gap-1.5">
                      {DAY_LABELS.map((label, dayNum) => {
                        const active = customDays.includes(dayNum);
                        return (
                          <button
                            key={label}
                            type="button"
                            aria-pressed={active}
                            onClick={() => toggleCustomDay(dayNum)}
                            className={cn(
                              "h-8 w-10 rounded-md border text-xs font-medium transition",
                              active
                                ? "border-accent bg-accent/15 text-accent"
                                : "border-border text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {repeatPattern === "custom" && customDays.length === 0 ? (
                    <p className="text-xs text-danger">Pick at least one day.</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {repeatCaption}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            editingTask.recurring_task_id && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-muted-foreground">
                <Repeat className="h-4 w-4" />
                Repeats daily
              </div>
            )
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={closeTaskDialog}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createDisabled}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
