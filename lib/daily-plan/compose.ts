/**
 * The daily plan's pure core: which items today's plan holds, the fixed order
 * used when the AI is unavailable, and the checks an AI-proposed order must
 * pass before it is trusted.
 *
 * PURE ON PURPOSE. Nothing here reads a clock, a database or the network —
 * every function takes the plan's IST civil date as an argument — so
 * scripts/test-daily-plan.mjs can pin the Monday/Tuesday behaviour without
 * mocking time, and the cron, the dashboard and the tests cannot disagree
 * about what "today's plan" means.
 *
 * Input shapes are declared structurally here rather than imported from
 * types/database so the test script can compile this file on its own.
 */
import { istDateString } from "@/lib/date";

export type PlanPriority = "low" | "medium" | "high";

export interface PlanAnchorInput {
  id: string;
  title: string;
  /** IST weekdays, 0 = Sunday … 6 = Saturday (same as istWeekday()). */
  days_of_week: number[];
  position: number;
  follows_anchor_id: string | null;
}

export interface PlanTaskInput {
  id: string;
  title: string;
  /** The stored timestamptz. Compared by IST civil day, never by instant. */
  due_date: string;
  priority: PlanPriority;
}

export type PlanCandidate =
  | {
      /** Short id the AI sees ("a1") — a UUID costs tokens and invites typos. */
      key: string;
      kind: "anchor";
      anchorId: string;
      title: string;
      position: number;
      /** Only set when the anchor it follows is ALSO in today's plan. */
      followsAnchorId: string | null;
      /** Moved here from yesterday's plan rather than scheduled for today. */
      carried: boolean;
    }
  | {
      key: string;
      kind: "task";
      taskId: string;
      title: string;
      dueDate: string;
      /** Whole IST days the task is late by; 0 = due on the plan's own day. */
      overdueDays: number;
      priority: PlanPriority;
    };

/**
 * Above this many items the AI is not asked: the deterministic order is used
 * instead. It bounds the prompt (measured ~445 prompt tokens for 7 items) and
 * keeps a long overdue pile from becoming a long, slow call. Every item still
 * goes into the plan — the cap decides who orders it, not what is in it.
 */
export const MAX_AI_ITEMS = 25;

/** Longest reason line kept. The prompt asks for at most 20 words. */
export const MAX_REASON_CHARS = 160;

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const PRIORITY_RANK: Record<PlanPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/** Epoch ms of a civil "YYYY-MM-DD" at 00:00 UTC — only ever used for civil
 *  arithmetic (weekday, day differences), where the zone cancels out. */
function civilMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

/** Weekday (0 = Sunday) of a civil date. The same in every zone by construction. */
export function civilWeekday(date: string): number {
  return new Date(civilMs(date)).getUTCDay();
}

export function civilWeekdayName(date: string): string {
  return WEEKDAY_NAMES[civilWeekday(date)];
}

/** A civil date plus `days` whole days, as "YYYY-MM-DD". */
export function addCivilDays(date: string, days: number): string {
  return new Date(civilMs(date) + days * 86_400_000).toISOString().slice(0, 10);
}

function civilDayDiff(later: string, earlier: string): number {
  return Math.round((civilMs(later) - civilMs(earlier)) / 86_400_000);
}

function byPositionThenTitle(a: PlanAnchorInput, b: PlanAnchorInput): number {
  return (
    a.position - b.position ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Today's plan items, in no particular order yet.
 *
 * - Anchors scheduled for the plan's IST weekday, plus anchors moved here from
 *   yesterday (`carriedAnchorIds`). An anchor that is both appears once.
 * - Tasks due on the plan's day or earlier (overdue). A task due LATER than
 *   the plan's day is dropped here even if the caller's query let it through:
 *   tomorrow's task must never appear in today's plan.
 *
 * Callers pass ACTIVE anchors and UNFINISHED dated tasks only.
 */
export function buildPlanCandidates(input: {
  planDate: string;
  anchors: PlanAnchorInput[];
  carriedAnchorIds: string[];
  tasks: PlanTaskInput[];
}): PlanCandidate[] {
  const { planDate, anchors, tasks } = input;
  const weekday = civilWeekday(planDate);
  const carried = new Set(input.carriedAnchorIds);

  const chosenAnchors = anchors
    .filter((a) => a.days_of_week.includes(weekday) || carried.has(a.id))
    .sort(byPositionThenTitle);
  const present = new Set(chosenAnchors.map((a) => a.id));

  const candidates: PlanCandidate[] = chosenAnchors.map((a, i) => ({
    key: `a${i + 1}`,
    kind: "anchor",
    anchorId: a.id,
    title: a.title,
    position: a.position,
    followsAnchorId:
      a.follows_anchor_id && present.has(a.follows_anchor_id)
        ? a.follows_anchor_id
        : null,
    carried: !a.days_of_week.includes(weekday),
  }));

  const seenTasks = new Set<string>();
  let t = 0;
  for (const task of tasks) {
    if (seenTasks.has(task.id)) continue;
    const dueMs = Date.parse(task.due_date);
    if (Number.isNaN(dueMs)) continue; // istDateString would throw on NaN
    const overdueDays = civilDayDiff(planDate, istDateString(dueMs));
    if (overdueDays < 0) continue; // due after the plan's day → not today
    seenTasks.add(task.id);
    t += 1;
    candidates.push({
      key: `t${t}`,
      kind: "task",
      taskId: task.id,
      title: task.title,
      dueDate: task.due_date,
      overdueDays,
      priority: task.priority,
    });
  }

  return candidates;
}

/** Key of the anchor each present anchor id maps to. */
function anchorKeyIndex(candidates: PlanCandidate[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const c of candidates) if (c.kind === "anchor") index.set(c.anchorId, c.key);
  return index;
}

/**
 * True when every "follows" anchor sits immediately after the anchor it
 * follows. The Instagram post must come right after the gym — not merely
 * later — so this is adjacency, not ordering.
 */
export function followsSatisfied(
  order: string[],
  candidates: PlanCandidate[]
): boolean {
  const keyOf = anchorKeyIndex(candidates);
  for (const c of candidates) {
    if (c.kind !== "anchor" || !c.followsAnchorId) continue;
    const leader = keyOf.get(c.followsAnchorId);
    if (!leader) continue;
    if (order.indexOf(c.key) !== order.indexOf(leader) + 1) return false;
  }
  return true;
}

/** Move each follower to directly after its leader. Bounded, so a malformed
 *  anchor set (two followers of one leader, a cycle) cannot loop forever. */
function placeFollowers(order: string[], candidates: PlanCandidate[]): string[] {
  const keyOf = anchorKeyIndex(candidates);
  const result = [...order];
  for (let pass = 0; pass < result.length; pass++) {
    let changed = false;
    for (const c of candidates) {
      if (c.kind !== "anchor" || !c.followsAnchorId) continue;
      const leader = keyOf.get(c.followsAnchorId);
      if (!leader) continue;
      const from = result.indexOf(c.key);
      if (from === result.indexOf(leader) + 1) continue;
      result.splice(from, 1);
      result.splice(result.indexOf(leader) + 1, 0, c.key);
      changed = true;
    }
    if (!changed) break;
  }
  return result;
}

/**
 * The order used whenever the AI is not: anchors first in their fixed
 * position (followers directly after their leader), then overdue tasks oldest
 * first, then today's tasks by priority. The plan must never be missing
 * because the AI failed, so this is a complete answer on its own.
 */
export function fallbackOrder(candidates: PlanCandidate[]): string[] {
  const anchors = candidates
    .filter((c) => c.kind === "anchor")
    .sort((a, b) =>
      a.kind === "anchor" && b.kind === "anchor" ? a.position - b.position : 0
    )
    .map((c) => c.key);

  const tasks = candidates.filter(
    (c): c is Extract<PlanCandidate, { kind: "task" }> => c.kind === "task"
  );
  const overdue = tasks
    .filter((c) => c.overdueDays > 0)
    .sort(
      (a, b) =>
        Date.parse(a.dueDate) - Date.parse(b.dueDate) ||
        a.title.localeCompare(b.title)
    )
    .map((c) => c.key);
  const today = tasks
    .filter((c) => c.overdueDays === 0)
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        a.title.localeCompare(b.title)
    )
    .map((c) => c.key);

  return [...placeFollowers(anchors, candidates), ...overdue, ...today];
}

/** One plain sentence that describes the fallback order truthfully. */
export function fallbackReason(candidates: PlanCandidate[]): string {
  const anchors = candidates.filter((c) => c.kind === "anchor").length;
  const tasks = candidates.filter(
    (c): c is Extract<PlanCandidate, { kind: "task" }> => c.kind === "task"
  );
  const overdue = tasks.filter((c) => c.overdueDays > 0).length;
  const today = tasks.length - overdue;

  const rest: string[] = [];
  if (overdue > 0) rest.push(`${overdue} overdue ${overdue === 1 ? "task" : "tasks"}`);
  if (today > 0) rest.push(`${today} due today`);

  if (anchors > 0 && rest.length === 0) return "Your fixed items for today, in their usual order.";
  if (anchors === 0 && rest.length === 0) return "Nothing is planned for today.";
  if (anchors === 0) return `Oldest first: ${rest.join(", then ")}.`;
  return `Your fixed items first, then ${rest.join(", then ")}.`;
}

/**
 * An AI-proposed order is used only if it is a permutation of exactly today's
 * items and keeps every "right after" pairing. Anything else returns null and
 * the caller uses fallbackOrder — a wrong plan is worse than a plain one.
 */
export function validateAiOrder(
  order: unknown,
  candidates: PlanCandidate[]
): string[] | null {
  if (!Array.isArray(order) || order.length !== candidates.length) return null;
  const known = new Set(candidates.map((c) => c.key));
  const seen = new Set<string>();
  for (const key of order) {
    if (typeof key !== "string" || !known.has(key) || seen.has(key)) return null;
    seen.add(key);
  }
  const keys = order as string[];
  return followsSatisfied(keys, candidates) ? keys : null;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "you", "then", "from", "into", "page",
]);

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function significantWords(text: string): string[] {
  return words(text).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** How far into the reason the first item must be named. */
const REASON_OPENING_WORDS = 6;

/**
 * The reason line, cleaned, or null when it cannot be trusted.
 *
 * WHY THE FIRST-ITEM CHECK. Measured on the real model before this was
 * written: in 3 of 3 runs the reason was "Start with the overdue task, then
 * high priority, keeping the gym flow intact" while the order it returned
 * began with Gym. The prompt now requires the reason to OPEN by naming the
 * first item, and this checks exactly that: a word of the first item's title
 * must appear in the reason's first few words.
 *
 * "Mentions it anywhere" is NOT enough, and the observed sentence is why — it
 * does say "gym", in its last clause, after naming a different item as first.
 * The check cannot prove the sentence true; it does catch that one.
 */
export function cleanAiReason(
  reason: unknown,
  firstTitle: string
): string | null {
  if (typeof reason !== "string") return null;
  const line = reason.replace(/\s+/g, " ").trim();
  if (!line || line.length > MAX_REASON_CHARS) return null;

  const wanted = significantWords(firstTitle);
  if (wanted.length === 0) return line; // nothing checkable (e.g. "Q4")
  const opening = words(line).slice(0, REASON_OPENING_WORDS);
  const named = opening.some((o) =>
    wanted.some((w) => o === w || (w.endsWith("s") && o === w.slice(0, -1)))
  );
  return named ? line : null;
}

/** What the model is shown for each item. No ids beyond the short key. */
export function aiPlanInput(candidates: PlanCandidate[]): Record<string, string>[] {
  const titleOf = new Map<string, string>();
  for (const c of candidates) if (c.kind === "anchor") titleOf.set(c.anchorId, c.title);

  return candidates.map((c) => {
    if (c.kind === "anchor") {
      const item: Record<string, string> = { id: c.key, kind: "anchor", title: c.title };
      if (c.followsAnchorId) item.right_after = titleOf.get(c.followsAnchorId) ?? "";
      if (c.carried) item.note = "moved here from yesterday";
      return item;
    }
    return {
      id: c.key,
      kind: "task",
      title: c.title,
      due:
        c.overdueDays === 0
          ? "today"
          : `overdue by ${c.overdueDays} day${c.overdueDays === 1 ? "" : "s"}`,
      priority: c.priority,
    };
  });
}

/** The p_items payload for create_daily_plan, in plan order. */
export function toPlanItemsPayload(
  order: string[],
  candidates: PlanCandidate[]
): {
  position: number;
  kind: "anchor" | "task";
  anchor_id: string | null;
  task_id: string | null;
  title: string;
}[] {
  const byKey = new Map(candidates.map((c) => [c.key, c]));
  return order.map((key, i) => {
    const c = byKey.get(key);
    if (!c) throw new Error(`toPlanItemsPayload: unknown key ${key}`);
    return {
      position: i + 1,
      kind: c.kind,
      anchor_id: c.kind === "anchor" ? c.anchorId : null,
      task_id: c.kind === "task" ? c.taskId : null,
      title: c.title,
    };
  });
}
