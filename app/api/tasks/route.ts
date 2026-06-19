import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { istDateString } from "@/lib/date";
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

  // "Repeat daily": create a recurring template, then spawn today's instance
  // (IST) linked to it; the cron (/api/cron/recurring-tasks) handles every day
  // after. Supabase JS has no multi-statement transaction, so we insert
  // sequentially (template first) and roll the template back if the instance
  // insert fails — no orphan template left to spawn tomorrow.
  if (body.repeat_daily === true) {
    const { data: recurring, error: recurringError } = await supabase
      .from("recurring_tasks")
      .insert({ user_id: user.id, title, priority, is_active: true })
      .select("id")
      .single();

    if (recurringError || !recurring) {
      return json(
        {
          data: null,
          error: recurringError?.message ?? "Failed to create recurring task",
        },
        500
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

    return json<Task>({ data, error: null }, 201);
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
      const { error: stopError } = await supabase
        .from("recurring_tasks")
        .update({ is_active: false })
        .eq("id", task.recurring_task_id);
      if (stopError) {
        return json({ data: null, error: stopError.message }, 500);
      }
    }
    return json<Task>({ data: task, error: null });
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

  if (Object.keys(updates).length === 0) {
    return json({ data: null, error: "No fields to update" }, 400);
  }

  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  if (!data) return json({ data: null, error: "Task not found" }, 404);
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

  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) return json({ data: null, error: error.message }, 500);
  return json<{ id: string }>({ data: { id }, error: null });
}
