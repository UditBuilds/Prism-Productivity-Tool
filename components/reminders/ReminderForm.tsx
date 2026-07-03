"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { istDateTimeToIso, istTimeValue } from "@/lib/date";
import { useUIStore } from "@/store/ui.store";
import { useCreateReminder, useUpdateReminder } from "@/hooks/useReminders";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { useTasksQuery } from "@/hooks/useTasks";
import { useNotesQuery } from "@/hooks/useNotes";
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

export function ReminderForm() {
  const { reminderDialogOpen, editingReminder, closeReminderDialog } =
    useUIStore();
  const createReminder = useCreateReminder();
  const updateReminder = useUpdateReminder();
  const { data: tasks = [] } = useTasksQuery();
  const { data: notes = [] } = useNotesQuery();
  const { subscribe } = usePushSubscription();

  // Read on the client only (null during SSR) so the permission hint below the
  // pickers can't cause a hydration mismatch.
  const [notifPermission, setNotifPermission] =
    useState<NotificationPermission | null>(null);
  useEffect(() => {
    if (typeof Notification !== "undefined") {
      setNotifPermission(Notification.permission);
    }
  }, [reminderDialogOpen]);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState("09:00");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [errors, setErrors] = useState<{
    title?: boolean;
    date?: boolean;
    time?: boolean;
  }>({});

  // Hydrate the form whenever the dialog opens (create vs edit).
  useEffect(() => {
    if (!reminderDialogOpen) return;
    setErrors({});
    if (editingReminder) {
      setTitle(editingReminder.title);
      setBody(editingReminder.body ?? "");
      setDate(new Date(editingReminder.remind_at));
      setTime(istTimeValue(editingReminder.remind_at));
      setTaskId(editingReminder.task_id);
      setNoteId(editingReminder.note_id);
    } else {
      setTitle("");
      setBody("");
      setDate(undefined);
      setTime("09:00");
      setTaskId(null);
      setNoteId(null);
    }
  }, [reminderDialogOpen, editingReminder]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    const nextErrors = {
      title: !trimmed,
      date: !date,
      time: !time,
    };
    if (nextErrors.title || nextErrors.date || nextErrors.time) {
      setErrors(nextErrors);
      return;
    }

    const remindAt = istDateTimeToIso(date as Date, time);
    const payload = {
      title: trimmed,
      body: body.trim() || null,
      remind_at: remindAt,
      task_id: taskId,
      note_id: noteId,
    };

    if (editingReminder) {
      updateReminder.mutate({ id: editingReminder.id, ...payload });
    } else {
      createReminder.mutate(payload);
      maybePromptForNotifications();
    }
    closeReminderDialog();
  }

  // After saving a NEW reminder, nudge toward browser notifications. The
  // toast's Enable button is a user gesture, so requestPermission works on iOS
  // (which silently ignores requests outside a gesture — see Session 8 notes).
  function maybePromptForNotifications() {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      toast(
        (t) => (
          <span className="flex items-center gap-3 text-sm">
            🔔 Enable notifications to get reminded on time?
            <button
              type="button"
              className="shrink-0 font-semibold text-accent"
              onClick={async () => {
                toast.dismiss(t.id);
                const result = await Notification.requestPermission();
                setNotifPermission(result);
                if (result === "granted") {
                  void subscribe(); // register Web Push for this device too
                  toast.success("Notifications enabled");
                }
              }}
            >
              Enable
            </button>
          </span>
        ),
        { duration: 8000 }
      );
    } else if (Notification.permission === "denied") {
      toast(
        "Notifications are blocked. Enable them in browser settings to receive reminders.",
        { icon: "🔕" }
      );
    }
  }

  return (
    <Dialog
      open={reminderDialogOpen}
      onOpenChange={(open) => !open && closeReminderDialog()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editingReminder ? "Edit reminder" : "New reminder"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reminder-title">Title</Label>
            <Input
              id="reminder-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errors.title) setErrors((p) => ({ ...p, title: false }));
              }}
              placeholder="What should we remind you about?"
              autoFocus
              className="rounded-lg"
            />
            {errors.title && (
              <p className="text-xs text-danger">Title is required.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="reminder-body">Note</Label>
            <Textarea
              id="reminder-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Optional details…"
              rows={2}
              className="rounded-lg"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "w-full justify-start rounded-lg font-normal",
                      !date && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {date ? format(date, "d MMM yyyy") : "Pick a date"}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(d) => {
                      setDate(d);
                      if (errors.date) setErrors((p) => ({ ...p, date: false }));
                    }}
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
              {errors.date && (
                <p className="text-xs text-danger">Date is required.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="reminder-time">Time</Label>
              <Input
                id="reminder-time"
                type="time"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  if (errors.time) setErrors((p) => ({ ...p, time: false }));
                }}
                className="rounded-lg"
              />
              {errors.time && (
                <p className="text-xs text-danger">Time is required.</p>
              )}
            </div>
          </div>

          {notifPermission !== null && notifPermission !== "granted" && (
            <p className="text-xs text-muted-foreground">
              ⚠️ Notifications are not enabled. You&apos;ll only see reminders
              while Prism is open.
            </p>
          )}

          {tasks.length > 0 && (
            <div className="space-y-2">
              <Label>Link a task</Label>
              <Select
                value={taskId ?? "none"}
                onValueChange={(v) => setTaskId(v === "none" ? null : v)}
              >
                <SelectTrigger className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No task</SelectItem>
                  {tasks.map((task) => (
                    <SelectItem key={task.id} value={task.id}>
                      {task.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {notes.length > 0 && (
            <div className="space-y-2">
              <Label>Link a note</Label>
              <Select
                value={noteId ?? "none"}
                onValueChange={(v) => setNoteId(v === "none" ? null : v)}
              >
                <SelectTrigger className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No note</SelectItem>
                  {notes.map((note) => (
                    <SelectItem key={note.id} value={note.id}>
                      {note.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={closeReminderDialog}
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
