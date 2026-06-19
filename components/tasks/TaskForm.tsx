"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
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
  const [titleError, setTitleError] = useState(false);

  // Hydrate the form whenever the dialog opens (create vs edit).
  useEffect(() => {
    if (!taskDialogOpen) return;
    setTitleError(false);
    setRepeatDaily(false); // create-only toggle; never carried into edit
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
      const createPayload = { ...payload, repeat_daily: repeatDaily };
      createTask.mutate(createPayload);
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
                  repeatDaily ? "bg-accent" : "bg-muted"
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
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
