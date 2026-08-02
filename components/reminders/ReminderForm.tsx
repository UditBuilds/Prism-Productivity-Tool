"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  istCivilToLocalDate,
  istDateString,
  istDateTimeToIso,
  istDayContext,
  istTimeValue,
  localCivilKey,
} from "@/lib/date";
import { useUIStore } from "@/store/ui.store";
import {
  useCreateReminder,
  useRemindersQuery,
  useUpdateReminder,
} from "@/hooks/useReminders";
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
import type { Reminder } from "@/types/database";

/** Most quick-pick chips shown at once. Beyond this the row stops scanning. */
const QUICK_PICK_LIMIT = 5;

/** Shared chip look — mirrors the due-date chips on the task form. */
const chipClass = (active: boolean) =>
  cn(
    "rounded-full border px-3 py-1 text-xs font-medium transition",
    active
      ? "border-accent bg-accent/15 text-accent"
      : "border-border text-muted-foreground hover:text-foreground"
  );

export function ReminderForm() {
  const { reminderDialogOpen, editingReminder, closeReminderDialog } =
    useUIStore();
  const createReminder = useCreateReminder();
  const updateReminder = useUpdateReminder();
  // Same ["reminders"] cache the page already reads — no extra request, no new
  // endpoint. GET /api/reminders returns every reminder for the user.
  const { data: allReminders = [] } = useRemindersQuery();
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

  /**
   * Reminders worth setting up again, newest first.
   *
   * Task-linked reminders are excluded deliberately: they carry the linked
   * task's title, are created as one-offs from the task form, and would
   * otherwise flood the list with things nobody re-creates by hand.
   *
   * Deduped by lowercased trimmed title, keeping the most recent instance.
   * The cache is ordered remind_at ascending (the API's order), so walking it
   * backwards gives most-recent-first and the first hit per title is the
   * keeper. Already-sent reminders stay in — a reminder that has fired is
   * exactly the kind you set up again.
   */
  const quickPicks = useMemo(() => {
    const seen = new Set<string>();
    const picks: Reminder[] = [];
    for (let i = allReminders.length - 1; i >= 0; i--) {
      const candidate = allReminders[i];
      if (candidate.task_id) continue;
      const key = candidate.title.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      picks.push(candidate);
      if (picks.length === QUICK_PICK_LIMIT) break;
    }
    return picks;
  }, [allReminders]);

  /**
   * Fill the form from an earlier reminder: title, body, and its clock time.
   * The day resolves to today while that clock is still ahead in IST, and to
   * tomorrow once it has passed — POST /api/reminders rejects a remind_at in
   * the past, so always defaulting to today would hand back a form that
   * cannot be saved.
   *
   * This only fills the form. Nothing is created until the user hits Save.
   */
  function applyQuickPick(source: Reminder) {
    const clock = istTimeValue(source.remind_at);
    const todayKey = istDateString();
    const todayAtClock = istDateTimeToIso(istCivilToLocalDate(todayKey), clock);
    const dayKey =
      Date.parse(todayAtClock) > Date.now()
        ? todayKey
        : istDateString(Date.parse(istDayContext().endOfToday));

    setTitle(source.title);
    setBody(source.body ?? "");
    setTime(clock);
    setDate(istCivilToLocalDate(dayKey));
    setErrors({});
  }

  // Recomputed every render (not memoised on mount) so a dialog left open
  // across IST midnight offers the new today. endOfToday IS 00:00 IST
  // tomorrow, so its IST civil date is tomorrow's.
  const dateChips = [
    { label: "Today", key: istDateString() },
    {
      label: "Tomorrow",
      key: istDateString(Date.parse(istDayContext().endOfToday)),
    },
  ];
  const currentDateKey = date ? localCivilKey(date) : null;

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
      // Small delay so it lands after the "Reminder created" success toast.
      setTimeout(() => {
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
      }, 500);
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
          {/* Create-only. Renders nothing at all when there is nothing to
              repeat — no empty state, no placeholder. */}
          {!editingReminder && quickPicks.length > 0 && (
            <div className="space-y-2">
              <Label>Repeat an earlier reminder</Label>
              <div className="flex flex-wrap gap-2">
                {quickPicks.map((pick) => (
                  <button
                    key={pick.id}
                    type="button"
                    onClick={() => applyQuickPick(pick)}
                    className={cn(chipClass(false), "max-w-full truncate")}
                    title={pick.title}
                  >
                    {pick.title}
                  </button>
                ))}
              </div>
            </div>
          )}

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

            {/* Spans both columns so "Tomorrow" never wraps at 375px.
                Selected state is derived from the value, so a date chosen in
                the picker lights the matching chip too. */}
            <div className="col-span-2 flex flex-wrap gap-2">
              {dateChips.map((chip) => {
                const active = currentDateKey === chip.key;
                return (
                  <button
                    key={chip.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setDate(istCivilToLocalDate(chip.key));
                      if (errors.date) setErrors((p) => ({ ...p, date: false }));
                    }}
                    className={chipClass(active)}
                  >
                    {chip.label}
                  </button>
                );
              })}
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
