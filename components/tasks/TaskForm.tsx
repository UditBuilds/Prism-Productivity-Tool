"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { Bell, CalendarIcon, Repeat, X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  istDateString,
  istDateTimeToIso,
  istDayContext,
  istTimeValue,
  istWeekday,
  nextIstMatchingDayName,
} from "@/lib/date";
import { useUIStore } from "@/store/ui.store";
import { useCreateTask, useUpdateTask } from "@/hooks/useTasks";
import {
  useCreateReminder,
  useDeleteReminder,
  useTaskReminder,
  useUpdateReminder,
} from "@/hooks/useReminders";
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
import { Switch } from "@/components/ui/switch";
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

/**
 * The form's `dueDate` is a Date whose LOCAL civil fields carry the intended
 * calendar day — that's the contract pickedDateToIso reads, and what the
 * Calendar's `selected` highlights. These two helpers move between that
 * representation and an IST civil date string ("YYYY-MM-DD").
 *
 * Which day counts as today/tomorrow is decided by the IST helpers below, never
 * by the browser clock, so the chips stay correct on a UTC server render and
 * across the 00:00–05:30 IST window where local time is still on yesterday.
 */
function istCivilToLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map((n) => Number.parseInt(n, 10));
  return new Date(y, m - 1, d);
}

function localCivilKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Opening time when the reminder toggle is switched on. For a task due today,
 * half an hour out — so the common case starts valid instead of immediately
 * tripping the past-time hint. Anything later in the week opens at 09:00.
 */
function defaultRemindTime(due: Date): string {
  const todayKey = istDateString();
  if (localCivilKey(due) !== todayKey) return "09:00";
  const soonMs = Date.now() + 30 * 60 * 1000;
  // Late at night +30m spills into tomorrow; clamp so the time stays on today.
  if (istDateString(soonMs) !== todayKey) return "23:59";
  return istTimeValue(new Date(soonMs).toISOString());
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

export function TaskForm() {
  const { taskDialogOpen, editingTask, closeTaskDialog } = useUIStore();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const { data: plans = [] } = usePlansQuery();
  const createReminder = useCreateReminder();
  const updateReminder = useUpdateReminder();
  const deleteReminder = useDeleteReminder();
  // The reminder this form owns for the task being edited (soonest unsent).
  const { data: linkedReminder, isSuccess: reminderLoaded } = useTaskReminder(
    editingTask?.id ?? null
  );
  const remindHydratedRef = useRef(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [planId, setPlanId] = useState<string | null>(null);
  const [repeatDaily, setRepeatDaily] = useState(false);
  const [repeatPattern, setRepeatPattern] = useState<RepeatPattern>("everyday");
  const [customDays, setCustomDays] = useState<number[]>([]);
  const [titleError, setTitleError] = useState(false);
  const [remindOn, setRemindOn] = useState(false);
  const [remindTime, setRemindTime] = useState("09:00");

  // Hydrate the form whenever the dialog opens (create vs edit).
  useEffect(() => {
    if (!taskDialogOpen) return;
    setTitleError(false);
    setRepeatDaily(false); // create-only toggle; never carried into edit
    setRepeatPattern("everyday");
    setCustomDays([]);
    setRemindOn(false); // turned back on below if this task already has one
    setRemindTime("09:00");
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

  // Quick-pick chips. Recomputed every render (not memoised on mount) so a tab
  // left open across IST midnight offers the new today, not the stale one.
  // endOfToday IS 00:00 IST tomorrow, so its IST civil date is tomorrow's.
  const dueDateChips = [
    { label: "Today", key: istDateString() },
    {
      label: "Tomorrow",
      key: istDateString(Date.parse(istDayContext().endOfToday)),
    },
  ];
  const currentDueKey = dueDate ? localCivilKey(dueDate) : null;

  // Hydrate the reminder controls exactly once per dialog open. The linked
  // reminder resolves from the ["reminders"] cache, which can settle after the
  // dialog is already open — but re-running on every cache change would fight
  // the user (toggling off would flip back on when the cache refetched).
  useEffect(() => {
    if (!taskDialogOpen) {
      remindHydratedRef.current = false;
      return;
    }
    if (remindHydratedRef.current || !reminderLoaded) return;
    remindHydratedRef.current = true;
    if (linkedReminder) {
      setRemindOn(true);
      setRemindTime(istTimeValue(linkedReminder.remind_at));
    }
  }, [taskDialogOpen, reminderLoaded, linkedReminder]);

  // A reminder needs a day to hang off, and recurring tasks are out of scope
  // (each spawned instance would need its own reminder — see the PR notes).
  const remindAvailable = !!dueDate && !repeatDaily;
  const remindActive = remindOn && remindAvailable;

  // The instant the reminder would fire: the task's due DAY + the chosen IST
  // wall-clock. Same helper the Reminders form uses, so "09:30" means 09:30 IST
  // no matter what timezone the browser is in.
  const remindAtIso =
    remindActive && dueDate ? istDateTimeToIso(dueDate, remindTime) : null;
  const remindInPast =
    remindAtIso !== null && Date.parse(remindAtIso) <= Date.now();
  // A due date in the past can never carry a reminder — say that, rather than
  // implying some other time on that day would work.
  const dueDayIsPast =
    !!dueDate && localCivilKey(dueDate) < istDateString();
  const remindError = !remindInPast
    ? null
    : dueDayIsPast
      ? "That date has already passed, so a reminder can't be set for it."
      : "That time has already passed — pick a later time.";

  const selectedDays =
    repeatPattern === "custom" ? customDays : PATTERN_DAYS[repeatPattern];
  const createDisabled =
    (!editingTask &&
      repeatDaily &&
      repeatPattern === "custom" &&
      customDays.length === 0) ||
    // POST /api/reminders rejects a past remind_at, so the form blocks it here
    // rather than letting the save half-succeed (task saved, reminder 400s).
    remindInPast;

  // Preview using the same IST weekday the server decides with — so the
  // caption and the actual create behavior can't disagree.
  const repeatCaption = selectedDays.includes(istWeekday())
    ? `Starts today, repeats on ${PATTERN_CAPTION[repeatPattern]}`
    : `Repeats on ${PATTERN_CAPTION[repeatPattern]}, first task on ${
        selectedDays.length > 0 ? nextIstMatchingDayName(selectedDays) : "—"
      }`;

  function toggleCustomDay(day: number) {
    setCustomDays((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : [...prev, day].sort((a, b) => a - b)
    );
  }

  /**
   * Reconcile the task's reminder on an edit save. Three outcomes:
   * update the row the form is showing, create one if the toggle was just
   * switched on, or delete it when the toggle went off (which includes
   * clearing the due date, since that makes the toggle unavailable).
   * Only unsent reminders are touched — useTaskReminder never returns a sent
   * one, so a delivered reminder stays put in the Sent tab.
   */
  function syncReminder(taskId: string, taskTitle: string) {
    if (remindActive && remindAtIso) {
      if (linkedReminder) {
        updateReminder.mutate({
          id: linkedReminder.id,
          title: taskTitle,
          remind_at: remindAtIso,
        });
      } else {
        createReminder.mutate({
          title: taskTitle,
          remind_at: remindAtIso,
          task_id: taskId,
        });
      }
    } else if (linkedReminder) {
      deleteReminder.mutate(linkedReminder.id);
    }
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
      syncReminder(editingTask.id, trimmed);
    } else {
      // repeat_daily rides along on the POST body; the API creates the
      // recurring template + today's instance (or defers it to the next
      // scheduled day — useCreateTask's onSuccess picks the right toast).
      createTask.mutate(
        {
          ...payload,
          repeat_daily: repeatDaily,
          days_of_week: selectedDays,
        },
        {
          // The task id only exists once the server responds, and task_id is
          // what makes the reminder deletable when the task is completed or
          // deleted — so the reminder is created here, not optimistically.
          onSuccess: (task) => {
            if (remindActive && remindAtIso) {
              createReminder.mutate({
                title: trimmed,
                remind_at: remindAtIso,
                task_id: task.id,
              });
            }
          },
        }
      );
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

            {/* Quick picks. Selected state is derived from the value, so a date
                chosen in the picker lights the matching chip too. Unsetting
                stays with the X — tapping a selected chip is a no-op. */}
            <div className="flex flex-wrap gap-2">
              {dueDateChips.map((chip) => {
                const active = currentDueKey === chip.key;
                return (
                  <button
                    key={chip.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDueDate(istCivilToLocalDate(chip.key))}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition",
                      active
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reminder — needs a due date to hang off. The task's due_date keeps
              its noon-IST anchor; the chosen time lives on the reminder. */}
          <div className="space-y-2">
            <label
              htmlFor="remind-me"
              className={cn(
                "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 transition",
                remindActive
                  ? "border-accent/40 bg-accent/10"
                  : "border-border bg-surface",
                remindAvailable
                  ? "cursor-pointer hover:bg-surface-raised"
                  : "cursor-not-allowed opacity-60"
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Bell className="h-4 w-4 text-muted-foreground" />
                Remind me
              </span>
              <Switch
                id="remind-me"
                checked={remindActive}
                disabled={!remindAvailable}
                onCheckedChange={(on) => {
                  setRemindOn(on);
                  if (on && dueDate) setRemindTime(defaultRemindTime(dueDate));
                }}
              />
            </label>

            {!remindAvailable && (
              <p className="text-xs text-muted-foreground">
                {repeatDaily
                  ? "Reminders aren't available on repeating tasks yet."
                  : "Set a due date to add a reminder."}
              </p>
            )}

            {remindActive && (
              <div className="space-y-2 rounded-lg border border-border bg-surface-raised/40 p-3">
                <Label htmlFor="remind-time">Remind at</Label>
                <Input
                  id="remind-time"
                  type="time"
                  value={remindTime}
                  onChange={(e) => setRemindTime(e.target.value)}
                  className="rounded-lg font-mono"
                />
                {remindError ? (
                  <p className="text-xs text-danger">{remindError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Fires at this time, IST.
                  </p>
                )}
              </div>
            )}
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
              <label
                htmlFor="repeat-daily"
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5 transition",
                  repeatDaily
                    ? "border-accent/40 bg-accent/10"
                    : "border-border bg-surface hover:bg-surface-raised"
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Repeat className="h-4 w-4 text-muted-foreground" />
                  Repeat daily
                </span>
                <Switch
                  id="repeat-daily"
                  checked={repeatDaily}
                  onCheckedChange={setRepeatDaily}
                />
              </label>

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
                              "h-9 w-10 rounded-md border font-mono text-xs font-medium transition",
                              active
                                ? "border-accent bg-accent/15 text-accent"
                                : "border-border-col text-muted-foreground hover:text-foreground"
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
