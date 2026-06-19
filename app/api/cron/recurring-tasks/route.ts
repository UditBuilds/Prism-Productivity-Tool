import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { istDateString } from "@/lib/date";
import type { Database, TaskPriority } from "@/types/database";

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

// `recurring_tasks` and `tasks.recurring_task_id` already exist in the database
// (the SQL has been run) but are not yet part of the shared `Database` type in
// types/database.ts. Describe the slice this route needs locally so the
// service-role client stays fully typed — no `any`.
type RecurringTaskRow = {
  id: string;
  user_id: string;
  title: string;
  // recurring_tasks.priority is TEXT; it mirrors tasks.priority's allowed values.
  priority: TaskPriority;
  is_active: boolean;
  created_at: string;
};

type TasksTable = Database["public"]["Tables"]["tasks"];

type RecurringSchema = {
  public: {
    Tables: Omit<Database["public"]["Tables"], "tasks"> & {
      tasks: {
        Row: TasksTable["Row"] & { recurring_task_id: string | null };
        Insert: TasksTable["Insert"] & { recurring_task_id?: string | null };
        Update: TasksTable["Update"] & { recurring_task_id?: string | null };
        Relationships: [];
      };
      recurring_tasks: {
        Row: RecurringTaskRow;
        Insert: RecurringTaskRow;
        Update: Partial<RecurringTaskRow>;
        Relationships: [];
      };
    };
    Views: Database["public"]["Views"];
    Functions: Database["public"]["Functions"];
    Enums: Database["public"]["Enums"];
    CompositeTypes: Database["public"]["CompositeTypes"];
  };
};

// POST /api/cron/recurring-tasks — cron-triggered: for each active recurring
// template, spawn today's task if it doesn't already exist. Idempotent: one
// task per template per IST day (also backed by the unique
// (recurring_task_id, due_date) index).
export async function POST(request: Request) {
  // Guard: only the scheduler (with the shared secret) may call this.
  if (request.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return json({ data: null, error: "Unauthorized" }, 401);
  }

  // Service-role client (bypasses RLS — must read every user's templates),
  // recast to the schema that includes the recurring-task tables.
  const supabase = createAdminClient() as unknown as SupabaseClient<RecurringSchema>;

  const today = istDateString(); // IST civil date "YYYY-MM-DD"

  const { data: templates, error: templatesError } = await supabase
    .from("recurring_tasks")
    .select("id, user_id, title, priority")
    .eq("is_active", true);

  if (templatesError) {
    return json({ data: null, error: templatesError.message }, 500);
  }

  let spawned = 0;

  for (const template of templates ?? []) {
    // Already spawned today? Skip (keeps re-runs idempotent).
    const { data: existing, error: existingError } = await supabase
      .from("tasks")
      .select("id")
      .eq("recurring_task_id", template.id)
      .eq("due_date", today)
      .maybeSingle();

    if (existingError) {
      // One bad row shouldn't abort the whole batch.
      console.error(
        `recurring-tasks: existence check failed for template ${template.id}: ${existingError.message}`
      );
      continue;
    }
    if (existing) continue;

    const { error: insertError } = await supabase.from("tasks").insert({
      user_id: template.user_id,
      title: template.title,
      priority: template.priority, // TaskPriority -> tasks.priority (TEXT); no cast needed
      due_date: today,
      status: "todo",
      recurring_task_id: template.id,
    });

    if (insertError) {
      // e.g. a concurrent run won the unique index — log and keep going.
      console.error(
        `recurring-tasks: insert failed for template ${template.id}: ${insertError.message}`
      );
      continue;
    }

    spawned += 1;
  }

  return json<{ spawned: number }>({ data: { spawned }, error: null });
}
