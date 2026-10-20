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

export type DailyPlanEdit =
  | { action: "accept"; plan_id: string }
  | { action: "move" | "drop"; item_id: string };

export interface DailyPlanEditResult {
  id: string;
  status?: DailyPlanItemStatus;
  moved_to?: string | null;
  accepted_at?: string | null;
}

/** Rows still on today's plan: not moved or dropped, and their source exists. */
export function activePlanItems(items: DailyPlanViewItem[]): DailyPlanViewItem[] {
  return items.filter((i) => i.status === "planned" && !i.gone);
}
