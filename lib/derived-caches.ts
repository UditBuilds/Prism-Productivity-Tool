import type { QueryClient } from "@tanstack/react-query";

/**
 * The calendar, productivity, weekly-review, and SRS-analytics queries are
 * read models DERIVED from the activity tables (tasks, reminders,
 * focus_sessions, srs_reviews, mood_logs). They cache aggressively
 * (60s–5min staleTime), so a mutation to a source table must mark the
 * derived caches stale — otherwise e.g. completing a task takes up to a
 * minute to dot the calendar and up to 5 minutes to appear in analytics.
 *
 * Invalidation only refetches mounted queries; unmounted ones are just
 * marked stale and refetch on next mount, so this is cheap to call on
 * every mutation.
 */
type ActivitySource =
  | "tasks"
  | "reminders"
  | "plans"
  | "focus"
  | "srs-review"
  | "mood";

// ["calendar"] prefix-matches every ["calendar", month] query.
const DERIVED_KEYS: Record<ActivitySource, string[][]> = {
  tasks: [["calendar"], ["productivity-analytics"], ["weekly-review"]],
  reminders: [["calendar"]],
  // Plans have a target_date; the calendar doesn't query them YET, but the
  // wiring is in place so it's already correct when that feature lands.
  plans: [["calendar"]],
  focus: [["productivity-analytics"], ["weekly-review"]],
  "srs-review": [
    ["productivity-analytics"],
    ["weekly-review"],
    ["srs-analytics"],
  ],
  mood: [["weekly-review"]],
};

export function invalidateDerivedCaches(
  qc: QueryClient,
  source: ActivitySource
): void {
  for (const queryKey of DERIVED_KEYS[source]) {
    void qc.invalidateQueries({ queryKey });
  }
}
