import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { istDateString, istWeekday } from "@/lib/date";
import type {
  Database,
  Task,
  TaskPriority,
  TaskStatus,
} from "@/types/database";

type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];

const STATUSES: TaskStatus[] = ["todo", "in_progress", "done"];
const PRIORITIES: TaskPriority[] = ["low", "medium", "high"];

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

function isStatus(v: unknown): v is TaskStatus {
  return typeof v === "string" && STATUSES.includes(v as TaskStatus);
}
function isPriority(v: unknown): v is TaskPriority {
  return typeof v === "string" && PRIORITIES.includes(v as TaskPriority);
}

/**
 * Remove a task's pending reminders. RLS scopes the delete to the caller, so
 * this can never reach another user's rows.
 *
 * Only `is_sent = false` rows are removed — a delivered reminder is history and
 * stays visible in the Reminders → Sent tab (PR #11). Best-effort: a failure
 * here is logged but never fails the task operation the user actually asked
 * for; the worst case is a stale reminder, not a lost task.
 */
async function deleteUnsentRemindersForTask(
  supabase: ReturnType<typeof createClient>,
  taskId: string
): Promise<void> {
  const { error } = await supabase
    .from("reminders")
    .delete()
    .eq("task_id", taskId)
    .eq("is_sent", false);
  if (error) {
    console.error(
      `tasks: failed to clear reminders for task ${taskId}: ${error.message}`
    );
  }
}

/**
 * The reminder a task "owns": the soonest UNSENT one pointing at it.
 *
 * Nothing enforces one reminder per task (no unique index — see PR #17), and
 * the Reminders page can attach another. Resolving the soonest unsent row makes
 * the behaviour deterministic, and living here means the task form, offline
 * replay, and any future caller all agree on which row that is.
 */
async function findLinkedReminderId(
  supabase: ReturnType<typeof createClient>,
  taskId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("reminders")
    .select("id")
    .eq("task_id", taskId)
    .eq("is_sent", false)
    .order("remind_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Result of reading the optional `reminder` field off a task request body.
 * The three states are distinct on purpose — see parseReminderField.
 */
type ReminderIntent =
  | { kind: "absent" }
  | { kind: "clear" }
  | { kind: "set"; remindAt: string };

/**
 * Read the optional `reminder` field.
 *
 * ABSENT must never be read as null. Status changes PATCH this route from the
 * swipe gesture, the context menu, the status pill and the dashboard row —
 * none of which know reminders exist. If a missing key meant "clear", every one
 * of those would silently delete a pending reminder.
 */
function parseReminderField(
  body: Record<string, unknown>
): ReminderIntent | { error: string } {
  if (!("reminder" in body)) return { kind: "absent" };
  const value = body.reminder;
  if (value === null) return { kind: "clear" };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: "reminder must be an object or null" };
  }
  const remindAtRaw = (value as Record<string, unknown>).remind_at;
  if (typeof remindAtRaw !== "string") {
    return { error: "A valid remind time is required" };
  }
  const ms = Date.parse(remindAtRaw);
  if (Number.isNaN(ms)) {
    return { error: "A valid remind time is required" };
  }
  // Same guard POST /api/reminders enforces, so the two creation paths can't
  // disagree about what a valid reminder is.
  if (ms <= Date.now()) {
    return { error: "Remind time must be in the future" };
  }
  return { kind: "set", remindAt: new Date(ms).toISOString() };
}

/**
 * Apply a parsed reminder intent to a task. Create-or-update the linked row, or
 * clear it. Never touches is_sent = true — delivered reminders are history and
 * stay in the Sent tab (PR #11).
 */
async function applyReminderIntent(
  supabase: ReturnType<typeof createClient>,
  intent: ReminderIntent,
  task: { id: string; user_id: string; title: string }
): Promise<string | null> {
  if (intent.kind === "absent") return null;

  if (intent.kind === "clear") {
    await deleteUnsentRemindersForTask(supabase, task.id);
    return null;
  }

  const existingId = await findLinkedReminderId(supabase, task.id);
  if (existingId) {
    const { error } = await supabase
      .from("reminders")
      .update({ title: task.title, remind_at: intent.remindAt })
      .eq("id", existingId);
    return error ? error.message : null;
  }

  const { error } = await supabase.from("reminders").insert({
    user_id: task.user_id,
    title: task.title,
    remind_at: intent.remindAt,
    task_id: task.id,
  });
  return error ? error.message : null;
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Normalise a submitted days_of_week to unique, sorted weekday numbers 0–6.
 *  Falls back to every day for missing/empty/invalid input (defensive — the
 *  form disables submit on an empty custom selection). */
function parseDaysOfWeek(v: unknown): number[] {
  if (!Array.isArray(v)) return ALL_DAYS;
  const days = Array.from(
    new Set(
      v.filter(
        (d): d is number =>
          typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6
      )
    )
  ).sort((a, b) => a - b);
  return days.length > 0 ? days : ALL_DAYS;
}

/**
 * Deactivate the recurring template behind a task instance so the cron stops
 * spawning future instances. Shared by the "Stop repeating" PATCH path and the
 * DELETE handler. Returns an error message on failure, or null on success.
 */
async function deactivateRecurringTemplate(
  supabase: ReturnType<typeof createClient>,
  recurringTaskId: string
): Promise<string | null> {
  const { error } = await supabase
    .from("recurring_tasks")
    .update({ is_active: false })
    .eq("id", recurringTaskId);
  return error ? error.message : null;
}

// GET /api/tasks — all tasks for the authed user
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) return json({ data: null, error: error.message }, 500);
  return json<Task[]>({ data: data ?? [], error: null });
}

// POST /api/tasks — create
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ data: null, error: "Invalid JSON body" }, 400);
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return json({ data: null, error: "Title is required" }, 400);

  if (body.status !== undefined && !isStatus(body.status)) {
    return json({ data: null, error: "Invalid status" }, 400);
  }
  if (body.priority !== undefined && !isPriority(body.priority)) {
    return json({ data: null, error: "Invalid priority" }, 400);
  }

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;
  const status: TaskStatus = isStatus(body.status) ? body.status : "todo";
  const priority: TaskPriority = isPriority(body.priority)
    ? body.priority
    : "medium";
  const planId = typeof body.plan_id === "string" ? body.plan_id : null;
  // Stamp completion if a task is created directly as done (the PATCH path
  // owns the done/un-done transitions for existing tasks).
  const completedAt = status === "done" ? new Date().toISOString() : null;

  // Validate the reminder BEFORE inserting anything — a 400 here must not leave
  // a task behind that the user never saw succeed.
  const reminderIntent = parseReminderField(body);
  if ("error" in reminderIntent) {
    return json({ data: null, error: reminderIntent.error }, 400);
  }
  // Spawned instances inherit nothing from their template (the cron writes only
  // task columns), so a reminder here would apply to today's instance alone and
  // silently vanish tomorrow. The form disables the toggle; say so explicitly
  // rather than accepting it and dropping it.
  if (reminderIntent.kind !== "absent" && body.repeat_daily === true) {
    return json(
      { data: null, error: "Reminders aren't supported on repeating tasks" },
      400
    );
  }

  // "Repeat daily": create a recurring template, then spawn today's instance
  // (IST) linked to it; the cron (/api/cron/recurring-tasks) handles every day
  // after. Supabase JS has no multi-statement transaction, so we insert
  // sequentially (template first) and roll the template back if the instance
  // insert fails — no orphan template left to spawn tomorrow.
  if (body.repeat_daily === true) {
    const daysOfWeek = parseDaysOfWeek(body.days_of_week);

    // Duplicate guard: one ACTIVE template per (user, case-insensitive title).
    // On a day the template isn't scheduled, creating it gives no visible task,
    // which historically led to re-creating the same template several times —
    // each copy then spawns its own instance every scheduled day. Backed by the
    // partial unique index idx_recurring_tasks_active_title (schema.sql).
    const duplicateError = `"${title}" already repeats. It only shows in your task list on its scheduled days — stop the existing one first if you want to change it.`;
    const { data: activeTemplates, error: activeError } = await supabase
      .from("recurring_tasks")
      .select("title")
      .eq("user_id", user.id)
      .eq("is_active", true);
    if (activeError) {
      return json({ data: null, error: activeError.message }, 500);
    }
    const normalizedTitle = title.trim().toLowerCase();
    const isDuplicate = (activeTemplates ?? []).some(
      (t) => t.title.trim().toLowerCase() === normalizedTitle
    );
    if (isDuplicate) {
      return json({ data: null, error: duplicateError }, 409);
    }

    const { data: recurring, error: recurringError } = await supabase
      .from("recurring_tasks")
      .insert({
        user_id: user.id,
        title,
        priority,
        is_active: true,
        days_of_week: daysOfWeek,
      })
      .select("id")
      .single();

    if (recurringError || !recurring) {
      // 23505 = a concurrent create slipped past the check above and lost the
      // race against the unique index — same friendly message as the guard.
      if (recurringError?.code === "23505") {
        return json({ data: null, error: duplicateError }, 409);
      }
      return json(
        {
          data: null,
          error: recurringError?.message ?? "Failed to create recurring task",
        },
        500
      );
    }

    // Only spawn today's instance if today (IST) is one of the selected days —
    // this is the authoritative check (the form's caption is a local-time
    // preview only). On a non-matching day the cron spawns the first instance
    // on the next matching day.
    if (daysOfWeek.includes(istWeekday())) {
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          user_id: user.id,
          title,
          description,
          status,
          priority,
          // Today (IST) — matches the cron's (recurring_task_id, due_date) key.
          due_date: istDateString(),
          plan_id: planId,
          recurring_task_id: recurring.id,
          completed_at: completedAt,
        })
        .select()
        .single();

      if (error || !data) {
        await supabase.from("recurring_tasks").delete().eq("id", recurring.id);
        return json(
          { data: null, error: error?.message ?? "Failed to create task" },
          500
        );
      }

      return json<Task & { instanceCreatedToday: boolean }>(
        { data: { ...data, instanceCreatedToday: true }, error: null },
        201
      );
    }

    // Template created, no instance today. Return the template id (non-null) so
    // the client's success check passes; the tasks list refetches on settle.
    // instanceCreatedToday lets the form explain the deferred first instance.
    return json<{ id: string; instanceCreatedToday: boolean }>(
      { data: { id: recurring.id, instanceCreatedToday: false }, error: null },
      201
    );
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: user.id,
      title,
      description,
      status,
      priority,
      due_date: typeof body.due_date === "string" ? body.due_date : null,
      plan_id: planId,
      completed_at: completedAt,
    })
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);

  // Same request, same queue entry: an offline create replays the task and its
  // reminder together, because the reminder was never a separate mutation.
  const reminderError = await applyReminderIntent(supabase, reminderIntent, {
    id: data.id,
    user_id: user.id,
    title: data.title,
  });
  if (reminderError) {
    return json({ data: null, error: reminderError }, 500);
  }
  return json<Task>({ data, error: null }, 201);
}

// PATCH /api/tasks — update (RLS guarantees ownership)
export async function PATCH(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ data: null, error: "Invalid JSON body" }, 400);
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return json({ data: null, error: "Task id is required" }, 400);

  // "Stop repeating": deactivate the task's recurring template so the cron stops
  // spawning future instances. Existing (today/past) instances are left intact.
  if (body.stop_recurring === true) {
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .single();
    if (taskError || !task) {
      return json({ data: null, error: "Task not found" }, 404);
    }
    if (task.recurring_task_id) {
      const stopError = await deactivateRecurringTemplate(
        supabase,
        task.recurring_task_id
      );
      if (stopError) {
        return json({ data: null, error: stopError }, 500);
      }
    }
    return json<Task>({ data: task, error: null });
  }

  // Parse before mutating anything so an invalid remind_at rejects the whole
  // save rather than leaving the task edited and the reminder not.
  const reminderIntent = parseReminderField(body);
  if ("error" in reminderIntent) {
    return json({ data: null, error: reminderIntent.error }, 400);
  }

  const updates: TaskUpdate = {};
  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return json({ data: null, error: "Title is required" }, 400);
    updates.title = title;
  }
  if (body.description !== undefined) {
    updates.description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
  }
  if (body.status !== undefined) {
    if (!isStatus(body.status))
      return json({ data: null, error: "Invalid status" }, 400);
    updates.status = body.status;

    if (body.status === "done") {
      // Stamp completed_at only the first time a task becomes done — preserve
      // any existing value so editing a done task doesn't re-date completion.
      const { data: existing } = await supabase
        .from("tasks")
        .select("completed_at")
        .eq("id", id)
        .single();
      updates.completed_at =
        existing?.completed_at ?? new Date().toISOString();
    } else {
      // Re-opening a task (todo / in_progress) clears its completion stamp.
      updates.completed_at = null;
    }
  }
  if (body.priority !== undefined) {
    if (!isPriority(body.priority))
      return json({ data: null, error: "Invalid priority" }, 400);
    updates.priority = body.priority;
  }
  if (body.due_date !== undefined) {
    updates.due_date =
      typeof body.due_date === "string" ? body.due_date : null;
  }
  if (body.plan_id !== undefined) {
    updates.plan_id = typeof body.plan_id === "string" ? body.plan_id : null;
  }

  const hasTaskUpdates = Object.keys(updates).length > 0;
  if (!hasTaskUpdates && reminderIntent.kind === "absent") {
    return json({ data: null, error: "No fields to update" }, 400);
  }

  // A reminder-only save is valid, so fall back to reading the row when there
  // are no task columns to write.
  const { data, error } = hasTaskUpdates
    ? await supabase.from("tasks").update(updates).eq("id", id).select().single()
    : await supabase.from("tasks").select().eq("id", id).single();

  if (error) return json({ data: null, error: error.message }, 500);
  if (!data) return json({ data: null, error: "Task not found" }, 404);

  // Completing a task retires its pending reminder — nagging about something
  // already done is noise. Done server-side because completion arrives from
  // several places (swipe, status pill, the dashboard row, offline resume).
  // Sent reminders are left alone: PR #11 made them history in the Sent tab.
  // This wins over any `reminder` in the same body: a task saved as done has no
  // pending reminder, whatever the toggle said.
  if (updates.status === "done") {
    await deleteUnsentRemindersForTask(supabase, id);
  } else {
    const reminderError = await applyReminderIntent(supabase, reminderIntent, {
      id,
      user_id: user.id,
      title: data.title,
    });
    if (reminderError) {
      return json({ data: null, error: reminderError }, 500);
    }
  }

  return json<Task>({ data, error: null });
}

// DELETE /api/tasks — delete by id (RLS guarantees ownership)
export async function DELETE(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ data: null, error: "Invalid JSON body" }, 400);
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return json({ data: null, error: "Task id is required" }, 400);

  // If this instance belongs to a recurring template, deactivate the template
  // FIRST (same logic as the "Stop repeating" PATCH) so the cron stops spawning
  // replacements. Only delete the instance once that succeeds — never leave a
  // deleted instance behind a still-active template.
  const { data: task, error: lookupError } = await supabase
    .from("tasks")
    .select("recurring_task_id")
    .eq("id", id)
    .maybeSingle();
  if (lookupError) return json({ data: null, error: lookupError.message }, 500);

  if (task?.recurring_task_id) {
    const stopError = await deactivateRecurringTemplate(
      supabase,
      task.recurring_task_id
    );
    if (stopError) return json({ data: null, error: stopError }, 500);
  }

  // Drop pending reminders BEFORE the task row goes. The FK is ON DELETE SET
  // NULL, so relying on it would leave an orphaned reminder with task_id null
  // that still fires for a task the user just deleted.
  await deleteUnsentRemindersForTask(supabase, id);

  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) return json({ data: null, error: error.message }, 500);
  return json<{ id: string }>({ data: { id }, error: null });
}
