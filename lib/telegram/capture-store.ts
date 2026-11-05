import type { SupabaseClient } from "@supabase/supabase-js";

import { istCivilDateToNoonIso, istClock12, istDateString } from "@/lib/date";
import type {
  CapturePromptAnchor,
  CapturePromptTask,
} from "@/lib/telegram/capture-schema";
import {
  REMINDER_MIN_LEAD_MS,
  type CaptureOp,
  type ResolveTask,
} from "@/lib/telegram/capture";
import type { Database, Json, TelegramCaptureStatus } from "@/types/database";

/**
 * Every database read and write the capture flow makes. Called with the
 * SERVICE ROLE from the webhook (there is no user session), so every query
 * filters on the owner's user_id explicitly — that filter is the only thing
 * scoping the bot to one person.
 *
 * Every write is awaited and its error checked: an un-awaited write can be
 * dropped when the serverless instance freezes after the response.
 */

type Db = SupabaseClient<Database>;
type TaskInsert = Database["public"]["Tables"]["tasks"]["Insert"];
type ReminderInsert = Database["public"]["Tables"]["reminders"]["Insert"];

/** Open tasks offered to the model as possible matches. */
const MAX_PROMPT_TASKS = 40;

/** A pending capture older than this is not saved: "today" has moved on. */
export const CAPTURE_TTL_MS = 24 * 60 * 60 * 1000;

export interface CaptureContext {
  promptTasks: CapturePromptTask[];
  promptAnchors: CapturePromptAnchor[];
  tasks: Map<string, ResolveTask>;
  anchors: Map<string, { id: string; title: string }>;
}

/**
 * The owner's open tasks (soonest due first, undated last) and active plan
 * anchors, each under a short ref the model can answer with. Real ids never
 * reach the model, so it cannot invent one.
 */
export async function loadCaptureContext(
  db: Db,
  ownerId: string,
  nowMs: number
): Promise<CaptureContext> {
  const [tasksRes, anchorsRes] = await Promise.all([
    db
      .from("tasks")
      .select("id, title, due_date")
      .eq("user_id", ownerId)
      .neq("status", "done")
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(MAX_PROMPT_TASKS),
    db
      .from("plan_anchors")
      .select("id, title")
      .eq("user_id", ownerId)
      .eq("is_active", true)
      .order("position", { ascending: true }),
  ]);
  if (tasksRes.error) throw new Error(`capture tasks: ${tasksRes.error.message}`);
  if (anchorsRes.error) throw new Error(`capture anchors: ${anchorsRes.error.message}`);

  const taskRows = tasksRes.data ?? [];
  const taskIds = taskRows.map((t) => t.id);

  // Each task's unsent future reminders, so "dentist at 5" can MOVE the one
  // it already has instead of adding a second.
  const pendingByTask = new Map<string, { id: string; remind_at: string }[]>();
  if (taskIds.length > 0) {
    const { data: reminders, error } = await db
      .from("reminders")
      .select("id, task_id, remind_at")
      .eq("user_id", ownerId)
      .in("task_id", taskIds)
      .eq("is_sent", false)
      .eq("delivery_status", "pending")
      .gt("remind_at", new Date(nowMs).toISOString());
    if (error) throw new Error(`capture reminders: ${error.message}`);
    for (const r of reminders ?? []) {
      if (!r.task_id) continue;
      const list = pendingByTask.get(r.task_id) ?? [];
      list.push({ id: r.id, remind_at: r.remind_at });
      pendingByTask.set(r.task_id, list);
    }
  }

  const promptTasks: CapturePromptTask[] = [];
  const tasks = new Map<string, ResolveTask>();
  taskRows.forEach((t, i) => {
    const ref = `t${i + 1}`;
    const due = t.due_date ? istDateString(Date.parse(t.due_date)) : null;
    const pending = pendingByTask.get(t.id) ?? [];
    promptTasks.push({ ref, title: t.title, due });
    tasks.set(ref, {
      id: t.id,
      title: t.title,
      due,
      pendingReminder: pending.length === 1 ? pending[0] : null,
    });
  });

  const promptAnchors: CapturePromptAnchor[] = [];
  const anchors = new Map<string, { id: string; title: string }>();
  (anchorsRes.data ?? []).forEach((a, i) => {
    const ref = `a${i + 1}`;
    promptAnchors.push({ ref, title: a.title });
    anchors.set(ref, { id: a.id, title: a.title });
  });

  return { promptTasks, promptAnchors, tasks, anchors };
}

/** True when this exact Telegram message was already read (a redelivery). */
export async function captureExists(
  db: Db,
  ownerId: string,
  chatId: number,
  sourceMessageId: number
): Promise<boolean> {
  const { data, error } = await db
    .from("telegram_captures")
    .select("id")
    .eq("user_id", ownerId)
    .eq("chat_id", chatId)
    .eq("source_message_id", sourceMessageId)
    .maybeSingle();
  if (error) throw new Error(`capture lookup: ${error.message}`);
  return !!data;
}

/**
 * Store what the bot understood, as 'pending'. Returns false when a row for
 * this message already exists — a concurrent redelivery won the insert, and
 * it alone sends the confirmation.
 */
export async function insertPendingCapture(
  db: Db,
  row: {
    id: string;
    ownerId: string;
    chatId: number;
    sourceMessageId: number;
    rawText: string;
    ops: CaptureOp[];
  }
): Promise<boolean> {
  const { data, error } = await db
    .from("telegram_captures")
    .upsert(
      {
        id: row.id,
        user_id: row.ownerId,
        chat_id: row.chatId,
        source_message_id: row.sourceMessageId,
        raw_text: row.rawText,
        items: row.ops as unknown as Json,
      },
      { onConflict: "chat_id,source_message_id", ignoreDuplicates: true }
    )
    .select("id");
  if (error) throw new Error(`capture insert: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function setReplyMessageId(
  db: Db,
  ownerId: string,
  captureId: string,
  replyMessageId: number
): Promise<void> {
  const { error } = await db
    .from("telegram_captures")
    .update({ reply_message_id: replyMessageId })
    .eq("id", captureId)
    .eq("user_id", ownerId);
  if (error) {
    // Not fatal: the buttons carry the capture id, not the message id.
    console.error(`[telegram] reply_message_id not saved for ${captureId}: ${error.message}`);
  }
}

export type SaveOutcome =
  | { kind: "saved"; ops: CaptureOp[]; notes: string[] }
  | { kind: "already"; status: TelegramCaptureStatus; ops: CaptureOp[] }
  | { kind: "expired"; ops: CaptureOp[] }
  | { kind: "not_found" };

async function readCapture(db: Db, ownerId: string, captureId: string) {
  const { data, error } = await db
    .from("telegram_captures")
    .select("id, status, items, created_at")
    .eq("id", captureId)
    .eq("user_id", ownerId)
    .maybeSingle();
  if (error) throw new Error(`capture read: ${error.message}`);
  if (!data) return null;
  return { ...data, ops: (Array.isArray(data.items) ? data.items : []) as unknown as CaptureOp[] };
}

/**
 * Save: write what the capture holds into tasks and reminders. IDEMPOTENT.
 *
 * Every row Save creates had its id chosen when the message was read, and is
 * inserted with ON CONFLICT (id) DO NOTHING. Every change to an existing row
 * sets a fixed value. So a double tap, a Telegram redelivery, or a retry
 * after a crash halfway through re-runs only no-ops; the capture flips to
 * 'saved' last, and only from 'pending'.
 *
 * The reminders API refuses a remind_at that is not in the future
 * (app/api/reminders/route.ts). This writes directly, so it applies the same
 * rule itself: a reminder whose time passed between reading and Save is not
 * created, and the reply says so.
 */
export async function saveCapture(
  db: Db,
  ownerId: string,
  captureId: string,
  nowMs: number
): Promise<SaveOutcome> {
  const capture = await readCapture(db, ownerId, captureId);
  if (!capture) return { kind: "not_found" };
  if (capture.status !== "pending") {
    return { kind: "already", status: capture.status, ops: capture.ops };
  }
  if (nowMs - Date.parse(capture.created_at) > CAPTURE_TTL_MS) {
    return { kind: "expired", ops: capture.ops };
  }

  const notes: string[] = [];
  const nowIso = new Date(nowMs).toISOString();
  const stillAhead = (iso: string) => Date.parse(iso) > nowMs + REMINDER_MIN_LEAD_MS;
  const passedNote = (title: string, iso: string) =>
    `${istClock12(iso)} for “${title}” had passed by the time you tapped Save, so there's no reminder for it.`;

  // 1. New tasks, one insert.
  const newTasks: TaskInsert[] = [];
  for (const op of capture.ops) {
    if (op.op !== "create_task") continue;
    newTasks.push({
      id: op.task_id,
      user_id: ownerId,
      title: op.title,
      description: null,
      status: "todo",
      priority: "medium",
      due_date: op.due_date ? istCivilDateToNoonIso(op.due_date) : null,
      plan_id: null,
      completed_at: null,
    });
  }
  if (newTasks.length > 0) {
    const { error } = await db
      .from("tasks")
      .upsert(newTasks, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error(`save tasks: ${error.message}`);
  }

  const newReminders: ReminderInsert[] = [];
  const queueReminder = (id: string, title: string, iso: string, taskId: string | null) =>
    newReminders.push({
      id,
      user_id: ownerId,
      title,
      body: null,
      remind_at: iso,
      task_id: taskId,
      note_id: null,
    });

  for (const op of capture.ops) {
    if (op.op === "create_task") {
      if (!op.reminder) continue;
      if (stillAhead(op.reminder.remind_at)) {
        queueReminder(op.reminder.id, op.title, op.reminder.remind_at, op.task_id);
      } else {
        notes.push(passedNote(op.title, op.reminder.remind_at));
      }
      continue;
    }

    if (op.op === "anchor_reminder") {
      if (stillAhead(op.reminder.remind_at)) {
        queueReminder(op.reminder.id, op.title, op.reminder.remind_at, null);
      } else {
        notes.push(passedNote(op.title, op.reminder.remind_at));
      }
      continue;
    }

    if (op.op !== "update_task") continue;

    // 2. A changed task. Matching no row means it was deleted since.
    if (op.due_date) {
      const { data, error } = await db
        .from("tasks")
        .update({ due_date: istCivilDateToNoonIso(op.due_date) })
        .eq("id", op.task_id)
        .eq("user_id", ownerId)
        .select("id");
      if (error) throw new Error(`save task date: ${error.message}`);
      if (!data || data.length === 0) {
        notes.push(`“${op.title}” isn't in Prism any more, so nothing changed for it.`);
        continue;
      }
    }

    if (!op.reminder) continue;
    if (!stillAhead(op.reminder.remind_at)) {
      notes.push(passedNote(op.title, op.reminder.remind_at));
      continue;
    }

    if (op.reminder.existing) {
      // 3. Move its one pending reminder — only while it is still unsent.
      // Revived to 'pending' exactly as the reminders PATCH does when it
      // reschedules into the future.
      const { data, error } = await db
        .from("reminders")
        .update({ remind_at: op.reminder.remind_at, delivery_status: "pending" })
        .eq("id", op.reminder.id)
        .eq("user_id", ownerId)
        .eq("is_sent", false)
        .select("id");
      if (error) throw new Error(`save reminder move: ${error.message}`);
      if (data && data.length > 0) continue;
      // It fired (or was deleted) since the message was read: add a new one.
      if (op.reminder.fallback_id) {
        queueReminder(op.reminder.fallback_id, op.title, op.reminder.remind_at, op.task_id);
      }
      continue;
    }

    queueReminder(op.reminder.id, op.title, op.reminder.remind_at, op.task_id);
  }

  // 4. New reminders, one insert. Linked tasks were written in step 1.
  if (newReminders.length > 0) {
    const { error } = await db
      .from("reminders")
      .upsert(newReminders, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error(`save reminders: ${error.message}`);
  }

  // 5. Last: the capture is saved. Only from 'pending', so a concurrent
  // Save that got here first is not overwritten (both did the same no-ops).
  const { error: flipError } = await db
    .from("telegram_captures")
    .update({ status: "saved", resolved_at: nowIso })
    .eq("id", captureId)
    .eq("user_id", ownerId)
    .eq("status", "pending");
  if (flipError) throw new Error(`save flip: ${flipError.message}`);

  return { kind: "saved", ops: capture.ops, notes };
}

export type CancelOutcome =
  | { kind: "cancelled"; ops: CaptureOp[] }
  | { kind: "already"; status: TelegramCaptureStatus; ops: CaptureOp[] }
  | { kind: "not_found" };

/** Cancel: nothing is written anywhere but the capture's own status. */
export async function cancelCapture(
  db: Db,
  ownerId: string,
  captureId: string,
  nowMs: number
): Promise<CancelOutcome> {
  const capture = await readCapture(db, ownerId, captureId);
  if (!capture) return { kind: "not_found" };
  if (capture.status !== "pending") {
    return { kind: "already", status: capture.status, ops: capture.ops };
  }
  const { data, error } = await db
    .from("telegram_captures")
    .update({ status: "cancelled", resolved_at: new Date(nowMs).toISOString() })
    .eq("id", captureId)
    .eq("user_id", ownerId)
    .eq("status", "pending")
    .select("id");
  if (error) throw new Error(`cancel: ${error.message}`);
  if (!data || data.length === 0) {
    // A Save landed in between; report what it is now.
    const now = await readCapture(db, ownerId, captureId);
    return now
      ? { kind: "already", status: now.status, ops: now.ops }
      : { kind: "not_found" };
  }
  return { kind: "cancelled", ops: capture.ops };
}
