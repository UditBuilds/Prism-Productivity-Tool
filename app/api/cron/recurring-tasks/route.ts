import { json } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { istDateString, istWeekday } from "@/lib/date";

// POST /api/cron/recurring-tasks — cron-triggered: for each active recurring
// template, spawn today's task if it doesn't already exist. Idempotent: one
// task per template per IST day (also backed by the unique
// (recurring_task_id, due_date) index).
export async function POST(request: Request) {
  // Guard: only the scheduler (with the shared secret) may call this. The
  // check runs before any DB call and a failure writes NOTHING —
  // unauthenticated callers control the request rate, so any per-request write
  // here would be unbounded. Don't add logging to this branch.
  if (request.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return json({ data: null, error: "Unauthorized" }, 401);
  }

  // Service-role client (bypasses RLS — must read every user's templates).
  const supabase = createAdminClient();

  const today = istDateString(); // IST civil date "YYYY-MM-DD"
  // IST weekday number (0=Sun … 6=Sat) via the shared lib/date helper.
  const todayWeekday = istWeekday();

  const { data: templates, error: templatesError } = await supabase
    .from("recurring_tasks")
    .select("id, user_id, title, priority, days_of_week")
    .eq("is_active", true);

  if (templatesError) {
    return json({ data: null, error: templatesError.message }, 500);
  }

  let spawned = 0;

  for (const template of templates ?? []) {
    // Weekday filter: only spawn on the template's selected IST weekdays.
    // Skips this template for today only (rows default to all 7 days).
    if (!template.days_of_week.includes(todayWeekday)) continue;

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
