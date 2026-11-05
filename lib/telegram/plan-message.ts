import {
  formatDueDate,
  istCivilDateToNoonIso,
  istDayLabel,
  istTimeValue,
} from "@/lib/date";
import {
  DAY_CAP,
  isPlanCleared,
  planCounts,
  planSections,
  planSubline,
  type DailyPlanView,
  type DailyPlanViewItem,
} from "@/lib/daily-plan/view";
import { planCallbackData } from "@/lib/telegram/callback-data";
import { clip } from "@/lib/telegram/format";
import type { InlineKeyboard } from "@/lib/telegram/types";

/** Rows shown (and given buttons) in one message; the rest are counted. */
export const MAX_PLAN_ROWS = 10;

/** Long titles are cut so ten rows always fit in one 4,096-char message. */
const MAX_TITLE_CHARS = 80;

/**
 * Today's plan as a Telegram message: the same rows, in the same order and
 * with the same words as the dashboard's plan card (components/dashboard/
 * DailyPlanPanel.tsx), drawn from the same DailyPlanView.
 *
 * Every row still on the plan and not done gets [n · Move to tomorrow]
 * [n · Drop]; one [Looks good] at the bottom does what the card's button
 * does (plan-level accept). There is no per-row "looks good": the app has no
 * such state.
 *
 * Once nothing is left to decide the message reads "Plan cleared" with no
 * buttons (isPlanCleared). That is worked out from the rows and writes
 * nothing: accepted_at still means only that Looks good was tapped.
 *
 * Pure: it reads only the view (and, through formatDueDate, today's IST
 * date), so a redraw after a tap is always the database's truth, and a double
 * tap cannot count anything twice.
 */
export function renderPlanMessage(view: DailyPlanView): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const plan = view.plan;
  if (!plan) return { text: "There's no plan for today.", keyboard: [] };

  const { leftovers, today, openTasks } = planSections(view.items, plan.plan_date);
  const cleared = isPlanCleared(view.items);

  const dateIso = istCivilDateToNoonIso(plan.plan_date);
  const lines: string[] = [
    `<b>Today's plan</b>${dateIso ? ` · ${istDayLabel(dateIso)}` : ""}`,
  ];

  // The card's header line, word for word.
  const line = planSubline(plan, view.items);
  if (line) lines.push(clip(line, 300));

  if (openTasks > DAY_CAP) {
    lines.push("", `${openTasks} tasks today. A realistic day is about ${DAY_CAP}.`);
  }

  const shown: { item: DailyPlanViewItem; n: number }[] = [];
  let n = 0;
  const pushGroup = (label: string | null, items: DailyPlanViewItem[]) => {
    const visible: string[] = [];
    for (const item of items) {
      n += 1;
      if (shown.length >= MAX_PLAN_ROWS) continue;
      shown.push({ item, n });
      visible.push(rowText(item, n));
    }
    if (visible.length === 0) return;
    lines.push("");
    if (label) lines.push(`<b>${label}</b>`);
    lines.push(...visible);
  };

  pushGroup(leftovers.length > 0 ? "Left over" : null, leftovers);
  pushGroup(leftovers.length > 0 ? "Today" : null, today);

  const onPlan = leftovers.length + today.length;
  if (onPlan > shown.length) {
    lines.push("", `+${onPlan - shown.length} more in Prism`);
  }
  if (cleared && !plan.accepted_at) {
    lines.push("", "<b>Plan cleared</b>");
  } else if (onPlan === 0) {
    lines.push("", "Nothing left on today's plan.");
  }

  if (plan.accepted_at) {
    lines.push("", `✓ Plan accepted at ${istTimeValue(plan.accepted_at)}`);
  }

  const keyboard: InlineKeyboard = [];
  for (const { item, n: number } of shown) {
    // A finished task has nothing left to move or drop (as on the card).
    if (item.task_done) continue;
    keyboard.push([
      { text: `${number} · Move to tomorrow`, callback_data: planCallbackData("m", item.id) },
      { text: `${number} · Drop`, callback_data: planCallbackData("d", item.id) },
    ]);
  }
  if (!plan.accepted_at && planCounts(view.items).left > 0) {
    keyboard.push([{ text: "Looks good", callback_data: planCallbackData("a", plan.id) }]);
  }

  return { text: lines.join("\n"), keyboard };
}

/**
 * One row: number, title, and the card's grey meta line. A past date reads
 * as a literal day ("Due Sat, Oct 17"), never a count of days overdue — no
 * guilt here either.
 */
function rowText(item: DailyPlanViewItem, n: number): string {
  const title = clip(item.title, MAX_TITLE_CHARS);
  const meta = rowMeta(item);
  const shownTitle = item.task_done ? `<s>${title}</s>` : title;
  return `${n}. ${shownTitle}${meta ? ` — ${meta}` : ""}`;
}

/** The same rules as rowMeta in DailyPlanPanel.tsx (not importable: a client file). */
function rowMeta(item: DailyPlanViewItem): string | null {
  if (item.kind === "task") {
    if (item.task_done) return "Done";
    const due = formatDueDate(item.task_due_date);
    if (!due || !item.task_due_date) return null;
    if (due.label === "Today") return "Due today";
    if (due.tone === "danger") return `Due ${istDayLabel(item.task_due_date)}`;
    return due.label;
  }
  if (item.after_title) return `Right after ${clip(item.after_title, MAX_TITLE_CHARS)}`;
  if (item.carried) return "Moved from yesterday";
  return null;
}
