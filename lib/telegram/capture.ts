import {
  istCivilDateTimeToIso,
  istCivilDateToNoonIso,
  istClock12,
  istDateString,
  istDayLabel,
} from "@/lib/date";
import { addCivilDays } from "@/lib/daily-plan/compose";
import type { CaptureAiItem } from "@/lib/telegram/capture-schema";
import { clip, escapeHtml } from "@/lib/telegram/format";

/**
 * From "what the message says" (the model's validated answer) to "what Save
 * will write" — and how that reads back to the person before they tap it.
 *
 * PURE: the clock and the id generator are arguments, so every IST edge case
 * (a time already passed, a message near midnight) is pinned by a unit test.
 *
 * THE MAPPING
 *   no match + no time   → a task, due on the named day (or undated)
 *   no match + time      → a task for that day + a reminder at that time,
 *                          linked to it ("dinner at 8")
 *   task match           → that task is changed: a named day re-dates it, a
 *                          time adds a reminder (or moves its one pending
 *                          reminder instead of adding a second)
 *   plan-item match      → a time makes a reminder titled with the item, linked
 *                          to nothing; the plan item itself is never touched
 *                          ("gym moved to 7pm")
 *   anything else        → shown, not saved ("already on your list")
 *
 * WHEN A TIME HAS PASSED. No day named and the time has gone today: the
 * reminder rolls to tomorrow and the line says so. A day named and its time
 * has gone ("tonight at 8" at 21:00): no reminder, and the line says so. An
 * hour with no am/pm the model could not settle takes whichever of the two is
 * next. Every line shows the weekday and date, which is what makes a
 * near-midnight reading visible before Save.
 */

/** A reminder closer than this to now is treated as already passed. */
export const REMINDER_MIN_LEAD_MS = 60_000;

export interface OpReminder {
  /** The reminder Save creates — or, when `existing`, the one it moves. */
  id: string;
  remind_at: string;
  /** Move the task's one pending reminder instead of adding a second. */
  existing: boolean;
  /** When `existing` but that reminder fired before Save: created fresh. */
  fallback_id: string | null;
}

export interface SimilarTask {
  title: string;
  due: string | null;
}

export type CaptureOp =
  | {
      op: "create_task";
      task_id: string;
      title: string;
      /** IST civil date, or null for an undated task. */
      due_date: string | null;
      reminder: OpReminder | null;
      note: string | null;
      similar: SimilarTask[];
    }
  | {
      op: "update_task";
      task_id: string;
      title: string;
      /** New IST civil due date, or null when the date is unchanged. */
      due_date: string | null;
      reminder: OpReminder | null;
      note: string | null;
    }
  | {
      op: "anchor_reminder";
      anchor_id: string;
      title: string;
      reminder: OpReminder;
      note: string | null;
    }
  | { op: "none"; title: string; note: string };

export interface ResolveTask {
  id: string;
  title: string;
  due: string | null;
  /** Its ONE unsent reminder still in the future, if it has exactly one. */
  pendingReminder: { id: string; remind_at: string } | null;
}

export interface ResolveContext {
  nowMs: number;
  /** By prompt ref ("t3"). */
  tasks: ReadonlyMap<string, ResolveTask>;
  /** By prompt ref ("a1"). */
  anchors: ReadonlyMap<string, { id: string; title: string }>;
  newId: () => string;
}

/** True when an op has something for Save to write. */
export function isActionable(op: CaptureOp): boolean {
  return op.op !== "none";
}

/** The two clock times an am/pm-less hour could mean, or just the one. */
function timeCandidates(time: string, ambiguous: boolean): string[] {
  const [hh, mm] = time.split(":");
  const h = Number.parseInt(hh, 10);
  const h12 = h % 12;
  if (!ambiguous || h12 === 0) return [time];
  const pad = (n: number) => String(n).padStart(2, "0");
  return [`${pad(h12)}:${mm}`, `${pad(h12 + 12)}:${mm}`];
}

interface When {
  date: string | null;
  remindAt: string | null;
  note: string | null;
}

/**
 * The day and the instant for one item. `fallbackDate` is the day a time
 * applies to when the message names none — a matched task's own future due
 * date; null means "today, or tomorrow if that time has gone".
 */
export function resolveWhen(
  date: string | null,
  time: string | null,
  ambiguous: boolean,
  nowMs: number,
  fallbackDate: string | null = null
): When {
  if (!time) return { date, remindAt: null, note: null };

  const candidates = timeCandidates(time, ambiguous);
  const earliestAhead = (day: string): string | null =>
    candidates
      .map((t) => istCivilDateTimeToIso(day, t))
      .filter((iso): iso is string => iso !== null && Date.parse(iso) > nowMs + REMINDER_MIN_LEAD_MS)
      .sort()[0] ?? null;

  const day = date ?? fallbackDate;
  if (day) {
    const at = earliestAhead(day);
    if (at) return { date: day, remindAt: at, note: null };
    // Only reachable for today: past days never get this far.
    const last = istCivilDateTimeToIso(day, candidates[candidates.length - 1]);
    return {
      date: day,
      remindAt: null,
      note: `${last ? istClock12(last) : "That time"} has already passed, so there's no reminder.`,
    };
  }

  const today = istDateString(nowMs);
  const atToday = earliestAhead(today);
  if (atToday) return { date: today, remindAt: atToday, note: null };

  const tomorrow = addCivilDays(today, 1);
  const atTomorrow = earliestAhead(tomorrow);
  if (!atTomorrow) return { date: today, remindAt: null, note: null }; // unreachable
  return {
    date: tomorrow,
    remindAt: atTomorrow,
    note: `${istClock12(atTomorrow)} today has passed, so I set it for tomorrow.`,
  };
}

export function resolveCapture(items: CaptureAiItem[], ctx: ResolveContext): CaptureOp[] {
  const today = istDateString(ctx.nowMs);
  return items.map((item): CaptureOp => {
    const task = item.match ? ctx.tasks.get(item.match) : undefined;
    const anchor = item.match ? ctx.anchors.get(item.match) : undefined;

    if (task) return resolveTaskUpdate(item, task, ctx, today);

    if (anchor) {
      if (!item.time) {
        return {
          op: "none",
          title: anchor.title,
          note: item.date
            ? "it's a fixed item on your plan, so I left it as it is. The Move button on the morning plan moves it to tomorrow."
            : "it's already on your plan.",
        };
      }
      const when = resolveWhen(item.date, item.time, item.time_ambiguous, ctx.nowMs);
      if (!when.remindAt) {
        return { op: "none", title: anchor.title, note: when.note ?? "nothing to change." };
      }
      return {
        op: "anchor_reminder",
        anchor_id: anchor.id,
        title: anchor.title,
        reminder: { id: ctx.newId(), remind_at: when.remindAt, existing: false, fallback_id: null },
        note: when.note,
      };
    }

    const when = resolveWhen(item.date, item.time, item.time_ambiguous, ctx.nowMs);
    const similar: SimilarTask[] = item.similar.flatMap((ref): SimilarTask[] => {
      const t = ctx.tasks.get(ref);
      if (t) return [{ title: t.title, due: t.due }];
      const a = ctx.anchors.get(ref);
      return a ? [{ title: a.title, due: null }] : [];
    });
    return {
      op: "create_task",
      task_id: ctx.newId(),
      title: item.title,
      due_date: when.date,
      reminder: when.remindAt
        ? { id: ctx.newId(), remind_at: when.remindAt, existing: false, fallback_id: null }
        : null,
      note: when.note,
      similar,
    };
  });
}

function resolveTaskUpdate(
  item: CaptureAiItem,
  task: ResolveTask,
  ctx: ResolveContext,
  today: string
): CaptureOp {
  // A time with no day goes on the task's own day when that is still ahead;
  // an undated or overdue task takes the day the time resolves to.
  const ownDay = task.due && task.due >= today ? task.due : null;
  const when = resolveWhen(item.date, item.time, item.time_ambiguous, ctx.nowMs, ownDay);

  let dueDate: string | null = null;
  if (item.date && item.date !== task.due) dueDate = item.date;
  else if (!item.date && item.time && !ownDay && when.date && when.date !== task.due) {
    dueDate = when.date;
  }

  let reminder: OpReminder | null = null;
  if (when.remindAt) {
    reminder = task.pendingReminder
      ? {
          id: task.pendingReminder.id,
          remind_at: when.remindAt,
          existing: true,
          fallback_id: ctx.newId(),
        }
      : { id: ctx.newId(), remind_at: when.remindAt, existing: false, fallback_id: null };
  }

  if (!dueDate && !reminder) {
    return {
      op: "none",
      title: task.title,
      note: when.note ?? "it's already on your list, so there's nothing to change.",
    };
  }
  return {
    op: "update_task",
    task_id: task.id,
    title: task.title,
    due_date: dueDate,
    reminder,
    note: when.note,
  };
}

/** "Fri, Nov 6 (tomorrow)" — weekday and date on every line, always. */
export function dayText(civil: string, nowMs: number): string {
  const iso = istCivilDateToNoonIso(civil);
  const label = iso ? istDayLabel(iso) : civil;
  const today = istDateString(nowMs);
  if (civil === today) return `${label} (today)`;
  if (civil === addCivilDays(today, 1)) return `${label} (tomorrow)`;
  return label;
}

function reminderText(r: OpReminder, nowMs: number): string {
  const day = istDateString(Date.parse(r.remind_at));
  return `${dayText(day, nowMs)}, ${istClock12(r.remind_at)}`;
}

const TITLE_CHARS = 100;

/** One numbered line per op, plus its notes, in plain words. */
export function captureLines(ops: CaptureOp[], nowMs: number): string[] {
  const lines: string[] = [];
  ops.forEach((op, i) => {
    const n = `${i + 1}.`;
    const title = `<b>${clip(op.title, TITLE_CHARS)}</b>`;
    if (op.op === "create_task") {
      const due = op.due_date ? dayText(op.due_date, nowMs) : "no date";
      const rem = op.reminder ? ` · reminder ${istClock12(op.reminder.remind_at)}` : "";
      lines.push(`${n} New task: ${title} — ${due}${rem}`);
      if (op.note) lines.push(`   <i>${escapeHtml(op.note)}</i>`);
      if (op.similar.length > 0) {
        const names = op.similar
          .map((s) => `“${clip(s.title, 60)}”${s.due ? ` (${dayText(s.due, nowMs)})` : ""}`)
          .join(", ");
        lines.push(
          `   <i>Similar: ${names}. If you meant one of those, tap Cancel and send it again with its exact name.</i>`
        );
      }
    } else if (op.op === "update_task") {
      const parts: string[] = [];
      if (op.due_date) parts.push(`move to ${dayText(op.due_date, nowMs)}`);
      if (op.reminder) {
        parts.push(
          `${op.reminder.existing ? "move its reminder to" : "reminder"} ${reminderText(op.reminder, nowMs)}`
        );
      }
      lines.push(`${n} Change: ${title} — ${parts.join(" · ")}`);
      if (op.note) lines.push(`   <i>${escapeHtml(op.note)}</i>`);
    } else if (op.op === "anchor_reminder") {
      lines.push(
        `${n} Reminder: ${title} — ${reminderText(op.reminder, nowMs)} (${clip(op.title, TITLE_CHARS)} stays on your plan as it is)`
      );
      if (op.note) lines.push(`   <i>${escapeHtml(op.note)}</i>`);
    } else {
      lines.push(`${n} ${title} — ${escapeHtml(op.note)}`);
    }
  });
  return lines;
}

export type CaptureMessageState = "pending" | "saved" | "cancelled" | "expired" | "nothing";

export function renderCaptureMessage(
  ops: CaptureOp[],
  state: CaptureMessageState,
  nowMs: number,
  saveNotes: string[] = []
): string {
  const head: Record<CaptureMessageState, string> = {
    pending: "Here's what I got. Nothing is saved until you tap Save.",
    saved: "<b>Saved.</b>",
    cancelled: "Cancelled — nothing was saved.",
    expired:
      "This one is more than a day old, so I didn't save it. Send it again and I'll read it fresh.",
    nothing: "There's nothing new to save in that one:",
  };
  const notes = saveNotes.map((s) => `<i>${escapeHtml(s)}</i>`);
  return [head[state], "", ...captureLines(ops, nowMs), ...(notes.length ? ["", ...notes] : [])].join(
    "\n"
  );
}

export const NOTHING_TO_SAVE =
  "Nothing to save in that one. Send me anything you want to remember — like “call mom tomorrow at 6”.";
