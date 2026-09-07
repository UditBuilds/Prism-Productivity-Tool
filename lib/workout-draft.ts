import type { StructuredSetInput } from "@/lib/workouts";

/**
 * The in-progress session draft, kept across navigation and reload.
 *
 * WHY LOCALSTORAGE AND NOT THE QUERY CACHE. A draft is not server state — it
 * has never been sent anywhere, so it has no query to belong to and no
 * mutation to be paused. React Query's IndexedDB snapshot persists caches and
 * paused mutations; an unsaved draft is neither. It is the same category as
 * "prism-theme": a per-viewer, per-device convenience.
 *
 * WHY IT IS KEYED BY USER. PR #34's lesson is that any client-side store which
 * outlives a session leaks between accounts on a shared browser. A draft is
 * eight exercises of somebody's training; it gets the same treatment as the
 * query snapshot, including a sweep on logout.
 *
 * EVERY OPERATION SWALLOWS FAILURES. Private mode, a full quota and a
 * disabled-storage browser all throw on access, and none of them is a reason
 * for the Workout page to break — the draft simply falls back to what it was
 * before this existed: page state that dies on navigation.
 */

const KEY_PREFIX = "prism-workout-draft";

function keyForUser(userId: string): string {
  return `${KEY_PREFIX}:${userId}`;
}

export interface WorkoutDraft {
  sets: StructuredSetInput[];
  /** IST civil day the draft is FOR, "YYYY-MM-DD" — the picker's contract. */
  day: string;
  /** When it was last written, ISO. Shown so a stale draft can be recognised. */
  savedAt: string;
}

/**
 * Validate a parsed blob into a draft, or null.
 *
 * Structural rather than trusting: this string survives deploys, so a draft
 * written by an older build can outlive the shape it was written in. A
 * malformed blob must produce "no draft", never a half-populated one that
 * saves wrong numbers — the whole point of the structured path is that the
 * values are exactly what the user tapped.
 */
function parseDraft(raw: unknown): WorkoutDraft | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;

  if (typeof value.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)) {
    return null;
  }
  if (!Array.isArray(value.sets) || value.sets.length === 0) return null;

  const sets: StructuredSetInput[] = [];
  for (const item of value.sets) {
    if (typeof item !== "object" || item === null) return null;
    const set = item as Record<string, unknown>;
    if (typeof set.exercise !== "string" || !set.exercise.trim()) return null;

    const weight =
      set.weight_kg === null || set.weight_kg === undefined
        ? null
        : typeof set.weight_kg === "number" && Number.isFinite(set.weight_kg)
          ? set.weight_kg
          : undefined;
    const reps =
      set.reps === null || set.reps === undefined
        ? null
        : typeof set.reps === "number" && Number.isInteger(set.reps)
          ? set.reps
          : undefined;
    if (weight === undefined || reps === undefined) return null;

    sets.push({ exercise: set.exercise, weight_kg: weight, reps });
  }

  return {
    sets,
    day: value.day,
    savedAt:
      typeof value.savedAt === "string" ? value.savedAt : new Date().toISOString(),
  };
}

export function readWorkoutDraft(userId: string): WorkoutDraft | null {
  try {
    const raw = window.localStorage.getItem(keyForUser(userId));
    if (!raw) return null;
    return parseDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeWorkoutDraft(
  userId: string,
  draft: Omit<WorkoutDraft, "savedAt">
): void {
  try {
    window.localStorage.setItem(
      keyForUser(userId),
      JSON.stringify({ ...draft, savedAt: new Date().toISOString() })
    );
  } catch {
    // Ignore — persistence is best-effort.
  }
}

export function clearWorkoutDraft(userId: string): void {
  try {
    window.localStorage.removeItem(keyForUser(userId));
  } catch {
    // Ignore.
  }
}

/**
 * Drop EVERY user's draft. Called on logout, alongside clearPersistedCaches():
 * once nobody is signed in on this browser, no account's training may remain
 * readable.
 */
export function clearAllWorkoutDrafts(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(KEY_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}
