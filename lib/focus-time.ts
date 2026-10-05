/**
 * Minutes to credit toward "time spent" stats: real elapsed time when tracked,
 * else the target for naturally-completed sessions, else 0 (untracked AND never
 * completed — unrecoverable, not a regression).
 *
 * ONE definition on purpose. Productivity analytics, the weekly review and the
 * tiny-wins push each carried an identical private copy; a rule edited in one
 * would have made the three disagree about the same session.
 */
export function creditedMinutes(s: {
  elapsed_seconds: number | null;
  completed: boolean;
  duration_minutes: number;
}): number {
  if (s.elapsed_seconds !== null) return s.elapsed_seconds / 60;
  if (s.completed) return s.duration_minutes;
  return 0;
}
