import type { Task } from "@/types/database";

export interface DisplayItem {
  task: Task;
  /** Older open sibling instances of the same recurring template (oldest
   *  first). Non-empty only for templates with 2+ open instances. */
  backlog: Task[];
}

/**
 * Collapse a recurring template's pile of open instances into ONE card.
 * The cron spawns a fresh `tasks` row per scheduled day, so an uncompleted
 * template accumulates near-identical siblings daily. Display-only grouping:
 * the newest open instance is the card (its actions complete only itself);
 * older ones ride along as `backlog` for the card's catch-up view. Done rows
 * and single-instance templates pass through untouched — the DB rows are
 * never merged, hidden, or altered (analytics depend on per-day history).
 */
export function groupRecurringBacklog(tasks: Task[]): DisplayItem[] {
  const openByTemplate = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.recurring_task_id && t.status !== "done") {
      const group = openByTemplate.get(t.recurring_task_id) ?? [];
      group.push(t);
      openByTemplate.set(t.recurring_task_id, group);
    }
  }

  const consumed = new Set<string>();
  const items: DisplayItem[] = [];
  for (const t of tasks) {
    if (consumed.has(t.id)) continue;
    const group =
      t.recurring_task_id && t.status !== "done"
        ? openByTemplate.get(t.recurring_task_id)
        : undefined;
    if (group && group.length > 1) {
      // Newest due_date fronts the card (normally today's instance); the
      // consolidated card sits at the group's first list position (the
      // oldest instance's slot — it IS overdue work).
      const sorted = [...group].sort((a, b) =>
        (a.due_date ?? "").localeCompare(b.due_date ?? "")
      );
      for (const g of sorted) consumed.add(g.id);
      items.push({
        task: sorted[sorted.length - 1],
        backlog: sorted.slice(0, -1),
      });
    } else {
      items.push({ task: t, backlog: [] });
    }
  }
  return items;
}
