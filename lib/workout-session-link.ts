import type { SupabaseClient } from "@supabase/supabase-js";

import { istCivilDayRange, istDateString } from "@/lib/date";
import { exerciseKey } from "@/lib/workouts";
import type { Database } from "@/types/database";

/**
 * Attaching a logged capture to its day's durable session.
 *
 * SERVER-ONLY, and it runs INSIDE POST /api/workouts rather than as its own
 * endpoint. That is the whole design, not a shortcut:
 *
 * TanStack dehydrates a paused mutation as {mutationKey, state, scope, meta} —
 * callbacks are not serialised — so anything sequenced through an onSuccess is
 * silently lost when a capture is made offline and replayed after a reload.
 * This project has already been bitten by exactly that (PR #19 moved a task's
 * reminder INSIDE the task mutation for the same reason). One save is
 * therefore one request: the set rows and the session rows land together or
 * not at all, and the offline queue needs no new key.
 *
 * That is also why the session id is derived here rather than generated in the
 * browser. `performed_at` already decides which IST day a capture belongs to,
 * so resolving the session from it cannot drift; a client-held id can — a
 * draft left open across IST midnight, or a capture queued yesterday and
 * replayed today, would carry an id whose stored `performed_on` contradicts
 * its own `performed_at`.
 */

type Db = SupabaseClient<Database>;

/** What the caller needs back: the session, and where each exercise landed. */
export interface SessionLink {
  sessionId: string;
  /** exerciseKey(name) -> session_exercises.id */
  exerciseIds: Map<string, string>;
}

/**
 * The one column of a row this module cares about.
 *
 * `undefined` is accepted alongside `null` so an Insert-shaped row can be
 * passed straight in — the generated Insert type makes every nullable column
 * optional, and both absences mean the same thing here: no exercise to name.
 */
export interface LinkableRow {
  exercise?: string | null;
}

/**
 * Distinct exercises in a capture, in first-seen order, as {key, displayName}.
 *
 * First-seen order is what becomes `position` for exercises new to the day, so
 * a session lists its exercises in the order they were actually trained.
 *
 * Unparsed rows (exercise null) contribute NOTHING. They have no name to make
 * a session_exercise from, and inventing one ("Unknown") would put a fake
 * exercise in the user's history; they keep session_exercise_id null and are
 * still reachable through the day's sets. Pure, so it is unit-testable without
 * a database.
 */
export function distinctExercises(
  rows: ReadonlyArray<LinkableRow>
): Array<{ key: string; displayName: string }> {
  const out: Array<{ key: string; displayName: string }> = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (typeof row.exercise !== "string") continue;
    const displayName = row.exercise.trim();
    if (!displayName) continue;
    const key = exerciseKey(displayName);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, displayName });
  }

  return out;
}

/**
 * Resolve — creating if absent — the session for the IST day of `performedAt`,
 * and a session_exercise for every exercise in the capture.
 *
 * BOTH STEPS ARE `ON CONFLICT DO NOTHING` FOLLOWED BY A SELECT, against the
 * two unique indexes (workout_sessions on user_id+performed_on,
 * session_exercises on session_id+exercise_key). A plain select-then-insert
 * would race, and not hypothetically: @tanstack/query-core's
 * resumePausedMutations() replays queued mutations with Promise.all and the
 * workout log mutation declares no `scope`, so a whole gym session captured
 * with no signal fires all of its captures at once the moment signal returns.
 *
 * `ignoreDuplicates` rather than a real upsert, because a DO UPDATE would
 * overwrite a session that already exists — resetting `started_at`, and
 * reviving a `completed` session back to `active`.
 *
 * A SET LOGGED AFTER "FINISH" DOES NOT REOPEN THE SESSION. It attaches to that
 * day as normal and the status stays `completed`: finishing is the user's
 * statement that they are done, and a late correction should not silently undo
 * it. The set is still filed under the right day either way.
 */
export async function linkCaptureToSession(
  supabase: Db,
  userId: string,
  performedAt: string,
  rows: ReadonlyArray<LinkableRow>
): Promise<SessionLink | null> {
  const performedOn = istDateString(Date.parse(performedAt));

  // ── the session ────────────────────────────────────────────────────
  const { error: sessionInsertError } = await supabase
    .from("workout_sessions")
    .upsert(
      {
        user_id: userId,
        performed_on: performedOn,
        status: "active",
        // The instant this day's first capture was logged. Never updated
        // afterwards: a later capture is later work, not an earlier start.
        started_at: performedAt,
      },
      { onConflict: "user_id,performed_on", ignoreDuplicates: true }
    );
  if (sessionInsertError) return null;

  const { data: session, error: sessionReadError } = await supabase
    .from("workout_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("performed_on", performedOn)
    .single();
  if (sessionReadError || !session) return null;

  const sessionId = session.id;
  const exercises = distinctExercises(rows);
  if (exercises.length === 0) {
    // An all-unparsed capture. The session is real — the day happened — but
    // there is nothing to name inside it.
    return { sessionId, exerciseIds: new Map() };
  }

  // ── its exercises ──────────────────────────────────────────────────
  // `position` continues the day's existing list rather than restarting at 0,
  // so exercises stay in the order they were trained across several captures.
  const { data: existing } = await supabase
    .from("session_exercises")
    .select("exercise_key, position")
    .eq("session_id", sessionId);

  let nextPosition = (existing ?? []).reduce(
    (max, row) => Math.max(max, row.position + 1),
    0
  );
  const known = new Set((existing ?? []).map((row) => row.exercise_key));

  const toInsert = exercises
    .filter((ex) => !known.has(ex.key))
    .map((ex) => ({
      user_id: userId,
      session_id: sessionId,
      display_name: ex.displayName,
      exercise_key: ex.key,
      position: nextPosition++,
    }));

  if (toInsert.length > 0) {
    const { error } = await supabase
      .from("session_exercises")
      .upsert(toInsert, {
        onConflict: "session_id,exercise_key",
        ignoreDuplicates: true,
      });
    if (error) return null;
  }

  // Read back unconditionally: with ignoreDuplicates a conflicting insert
  // returns nothing, so the select is the only source of ids that is correct
  // whether this capture created the rows or lost a race for them.
  const { data: linked, error: linkedError } = await supabase
    .from("session_exercises")
    .select("id, exercise_key")
    .eq("session_id", sessionId);
  if (linkedError || !linked) return null;

  const exerciseIds = new Map<string, string>();
  for (const row of linked) {
    if (row.exercise_key) exerciseIds.set(row.exercise_key, row.id);
  }

  return { sessionId, exerciseIds };
}

/**
 * Tidy up after a set is deleted, so History never lists a day that no longer
 * has any work in it.
 *
 * This repairs damage this feature itself would otherwise cause: before
 * sessions existed, deleting the last set of a day simply left no trace of the
 * day; now it would leave an empty session and an empty exercise behind it.
 *
 * DELIBERATELY NOT THE REVERSE OF ON DELETE SET NULL. That FK protects sets
 * from having their session deleted out from under them — raw logged data
 * outlives any reorganisation. This removes only CONTAINERS that have nothing
 * left inside them, which is the opposite direction and destroys nothing the
 * user logged.
 *
 * The session is dropped only when the whole IST DAY is empty, not merely when
 * it has no named exercises: a day whose only remaining rows are unparsed
 * still happened, and those rows carry session_exercise_id null so they would
 * otherwise vanish from History while still existing in the table.
 *
 * Failures are swallowed. The set is already gone, which is what the user
 * asked for; a stranded empty container is untidy, not wrong.
 */
export async function pruneEmptySessionContainers(
  supabase: Db,
  userId: string,
  sessionExerciseId: string
): Promise<void> {
  const { data: exercise } = await supabase
    .from("session_exercises")
    .select("id, session_id")
    .eq("id", sessionExerciseId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!exercise) return;

  const { count: setsLeft } = await supabase
    .from("workout_sets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("session_exercise_id", sessionExerciseId);
  if ((setsLeft ?? 0) > 0) return;

  await supabase
    .from("session_exercises")
    .delete()
    .eq("id", sessionExerciseId)
    .eq("user_id", userId);

  const { data: session } = await supabase
    .from("workout_sessions")
    .select("id, performed_on")
    .eq("id", exercise.session_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!session) return;

  const range = istCivilDayRange(session.performed_on);
  if (!range) return;

  const { count: daySets } = await supabase
    .from("workout_sets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("performed_at", range.start)
    .lt("performed_at", range.end);
  if ((daySets ?? 0) > 0) return;

  // Cascades any session_exercises that somehow survive; there should be none.
  await supabase
    .from("workout_sessions")
    .delete()
    .eq("id", session.id)
    .eq("user_id", userId);
}
