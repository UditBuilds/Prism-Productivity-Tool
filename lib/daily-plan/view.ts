import { istDateString } from "@/lib/date";
import type {
  DailyPlanItemKind,
  DailyPlanItemStatus,
  DailyPlanSource,
} from "@/types/database";

/**
 * What POST /api/daily-plan returns and the dashboard renders. Shared by the
 * route and the hook; no server imports, so it is safe in client bundles.
 *
 * `plan: null` means the planner is OFF for this user (no active anchors), not
 * that something failed — the panel renders nothing. It is a value rather than
 * a null `data` because apiFetch treats a null `data` as an error.
 */
export interface DailyPlanView {
  plan: {
    id: string;
    plan_date: string;
    source: DailyPlanSource;
    reason: string;
    accepted_at: string | null;
  } | null;
  items: DailyPlanViewItem[];
}

export interface DailyPlanViewItem {
  id: string;
  position: number;
  kind: DailyPlanItemKind;
  title: string;
  status: DailyPlanItemStatus;
  moved_to: string | null;
  /** The task behind a task row, for Done (a plain task update). null for an
   *  anchor or a deleted task; absent in a snapshot cached before it existed. */
  task_id?: string | null;
  /** The task's CURRENT due date (it may have been edited since). */
  task_due_date: string | null;
  /** The task was completed since the plan was made. */
  task_done: boolean;
  /** Title of the anchor this one sits directly after, when both are here. */
  after_title: string | null;
  /** An anchor moved here from yesterday rather than scheduled for today. */
  carried: boolean;
  /** The task or anchor behind this row was deleted. */
  gone: boolean;
}

/**
 * `move_all` carries PLAN ITEM ids, not task ids: a move has to mark the item
 * as well as re-date the task, or the row would stay on today's plan reading
 * "Tomorrow". The full list rides in the variables so a queued edit replays
 * with nothing to recompute.
 */
export type DailyPlanEdit =
  | { action: "accept"; plan_id: string }
  | { action: "move" | "drop"; item_id: string }
  | { action: "move_all"; item_ids: string[] };

export interface DailyPlanEditResult {
  id: string;
  status?: DailyPlanItemStatus;
  moved_to?: string | null;
  accepted_at?: string | null;
}

/** What PATCH returns: one item, or one entry per item for `move_all`. */
export type DailyPlanEditResponse =
  | DailyPlanEditResult
  | { items: DailyPlanEditResult[] };

/** Above this many unfinished tasks the panel says the day is too full. */
export const DAY_CAP = 5;

/** Rows still on today's plan: not moved or dropped, and their source exists. */
export function activePlanItems(items: DailyPlanViewItem[]): DailyPlanViewItem[] {
  return items.filter((i) => i.status === "planned" && !i.gone);
}

/**
 * A task row whose CURRENT due date is an earlier IST day than the plan's own.
 * Compared with the plan's date, never the clock, so the panel and
 * PATCH /api/daily-plan (which clears a dropped leftover's date by the same
 * rule) cannot disagree about which rows are leftovers.
 */
export function isLeftover(item: DailyPlanViewItem, planDate: string): boolean {
  if (item.kind !== "task" || !item.task_due_date) return false;
  const dueMs = Date.parse(item.task_due_date);
  if (Number.isNaN(dueMs)) return false;
  return istDateString(dueMs) < planDate;
}

export interface PlanSections {
  /** Leftover rows in plan order, done ones included (shown struck through). */
  leftovers: DailyPlanViewItem[];
  /** Leftovers not yet done: what "Move all" moves and the header counts. */
  openLeftovers: DailyPlanViewItem[];
  /** Every other row still on the plan, in plan order. */
  today: DailyPlanViewItem[];
  /** Unfinished TASKS among `today`. Anchors are never counted. */
  openTodayTasks: number;
  /** Unfinished tasks on the plan, leftovers included — what DAY_CAP is held
   *  against. Anchors are fixed and the warning cannot ask for them to go, so
   *  they are left out; done tasks are no longer load. */
  openTasks: number;
}

/**
 * Today's plan split for display: leftovers from earlier days first, then the
 * rest in the plan's own order.
 *
 * Once every leftover is done the group is closed and its done rows go with
 * it — they are not moved down into today's list, where they never were.
 */
export function planSections(
  items: DailyPlanViewItem[],
  planDate: string
): PlanSections {
  const active = activePlanItems(items);
  const leftovers = active.filter((i) => isLeftover(i, planDate));
  const openLeftovers = leftovers.filter((i) => !i.task_done);
  const today = active.filter((i) => !isLeftover(i, planDate));
  const openTodayTasks = today.filter((i) => i.kind === "task" && !i.task_done).length;
  return {
    leftovers: openLeftovers.length > 0 ? leftovers : [],
    openLeftovers,
    today,
    openTodayTasks,
    openTasks: openLeftovers.length + openTodayTasks,
  };
}

export interface PlanCounts {
  /** On the plan, source not deleted, not done. Anchors count: on most days
   *  they are the whole plan. */
  left: number;
  moved: number;
  /** Dropped tasks and skipped anchors. The two words differ only in the
   *  database; to the person reading, both are off today's plan. */
  dropped: number;
  /** Tasks still on the plan that were completed since it was made. */
  done: number;
}

export function planCounts(items: DailyPlanViewItem[]): PlanCounts {
  const active = activePlanItems(items);
  const done = active.filter((i) => i.task_done).length;
  return {
    left: active.length - done,
    moved: items.filter((i) => i.status === "moved").length,
    dropped: items.filter((i) => i.status === "dropped" || i.status === "skipped")
      .length,
    done,
  };
}

/** "3 left · 1 moved · 1 dropped", leaving out the parts that are zero. */
export function planCountLine({ left, moved, dropped }: PlanCounts): string {
  return [
    left > 0 ? `${left} left` : null,
    moved > 0 ? `${moved} moved` : null,
    dropped > 0 ? `${dropped} dropped` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Nothing is left to decide, and something happened to get there.
 *
 * DERIVED, NEVER STORED, and deliberately not `accepted_at`: that column means
 * only "the person tapped Looks good", so no edit ever writes it. Because this
 * reads the rows, it holds however the plan got here — Move or Drop in the app
 * or the bot, or a task completed through the tasks route, which never sees
 * the plan at all.
 */
export function isPlanCleared(items: DailyPlanViewItem[]): boolean {
  const { left, moved, dropped, done } = planCounts(items);
  return left === 0 && moved + dropped + done > 0;
}

/**
 * The line under "Today's plan", the same on the dashboard card and in the
 * Telegram message. null means no line.
 *
 * The stored reason describes the plan's order as it was made, opening with
 * its first item, so it is only shown while that is still true: any Move or
 * Drop replaces it with plain counts, and a leftover that now sits above the
 * first item replaces it with the leftover count. A plan cleared by Done alone
 * has no count to show and an out-of-date reason, so it gets no line.
 */
export function planSubline(
  plan: { plan_date: string; reason: string },
  items: DailyPlanViewItem[]
): string | null {
  const counts = planCounts(items);
  if (counts.moved + counts.dropped > 0) return planCountLine(counts);
  if (isPlanCleared(items)) return null;

  const { openLeftovers, openTodayTasks } = planSections(items, plan.plan_date);
  if (openLeftovers.length === 0) return plan.reason;
  return [
    `${openLeftovers.length} left over`,
    openTodayTasks > 0 ? `${openTodayTasks} for today` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
