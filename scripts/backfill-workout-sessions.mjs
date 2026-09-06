/**
 * ONE-OFF: build durable workout_sessions / session_exercises rows for the
 * workout_sets that predate them, and link the sets to their place.
 *
 * This is NOT a standing code path. Every capture from here on is linked by
 * POST /api/workouts inside the same request that inserts its sets
 * (lib/workout-session-link.ts); this exists only for the rows written before
 * that code did.
 *
 * GROUPED BY (user_id, IST CALENDAR DAY), NEVER BY capture_id. Real days are
 * split across several captures because sets get logged as they happen —
 * 2026-08-30 is eight captures and 2026-08-20 is three. Keyed by capture, six
 * real sessions would become eighteen fake ones.
 *
 * SAFETY
 * - Dry run by default. It prints exactly what it would create and writes
 *   NOTHING unless you pass --apply.
 * - --user=<uuid> is REQUIRED. The service-role key bypasses RLS, and this
 *   project's Supabase holds five profiles with three people's real data;
 *   every read and write below is filtered to that one id. There is no
 *   "all users" mode on purpose.
 * - Idempotent. Sessions and exercises are inserted with ON CONFLICT DO
 *   NOTHING against the two unique indexes, and only sets with
 *   session_exercise_id IS NULL are linked — so a re-run cannot duplicate and
 *   an interrupted run resumes by being run again.
 * - It writes ONLY session_exercise_id on workout_sets. Nothing the user
 *   logged is touched.
 *
 * Backfilled sessions are marked status='completed': they are all in the past,
 * and leaving them 'active' would fill History with workouts that look like
 * they are still in progress.
 *
 * Run:
 *   node scripts/backfill-workout-sessions.mjs --user=<uuid>
 *   node scripts/backfill-workout-sessions.mjs --user=<uuid> --apply
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const APPLY = process.argv.includes("--apply");
const USER = (() => {
  const arg = process.argv.find((a) => a.startsWith("--user="));
  return arg ? arg.slice("--user=".length).trim() : null;
})();

function env(name) {
  const line = readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(name + "="));
  if (!line) throw new Error(name + " missing from .env.local");
  return line
    .slice(name.length + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
}

/**
 * Byte-identical to istDateString() in lib/date.ts.
 *
 * Copied rather than imported because that module is TypeScript and pulls in
 * the rest of the date helpers; the whole grouping rule is this one function,
 * and a divergence would put a set on the wrong day silently. If lib/date.ts's
 * version ever changes, change this one with it.
 */
function istDateString(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** Byte-identical to exerciseKey() in lib/workouts.ts, for the same reason. */
function exerciseKey(name) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
const headers = { apikey: key, Authorization: "Bearer " + key };

async function rest(pathAndQuery, init = {}) {
  const res = await fetch(url + "/rest/v1/" + pathAndQuery, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      init.method + " " + pathAndQuery + " -> " + res.status + " " + text
    );
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  if (!USER) {
    console.error(
      "\n--user=<uuid> is required.\n\n" +
        "The service-role key bypasses RLS and this project holds several\n" +
        "people's real data, so this script will not run unscoped.\n"
    );
    process.exit(1);
  }

  console.log("\nUser: " + USER);
  console.log(APPLY ? "Mode: APPLY (writes)" : "Mode: DRY RUN (no writes)");

  // ── read ───────────────────────────────────────────────────────────
  const sets = await rest(
    "workout_sets?select=id,performed_at,exercise,session_exercise_id" +
      "&user_id=eq." +
      USER +
      "&order=performed_at.asc,set_index.asc.nullslast&limit=100000"
  );
  console.log("\nworkout_sets rows for this user: " + sets.length);
  if (sets.length === 0) {
    console.log("Nothing to do.\n");
    return;
  }

  // ── plan ───────────────────────────────────────────────────────────
  // Days in first-seen order; exercises within a day likewise, which becomes
  // `position` so a session lists its exercises in the order they were
  // trained.
  const days = new Map();
  for (const row of sets) {
    const day = istDateString(Date.parse(row.performed_at));
    let entry = days.get(day);
    if (!entry) {
      entry = { day, exercises: new Map(), rows: [], unparsed: 0 };
      days.set(day, entry);
    }
    entry.rows.push(row);

    const name = typeof row.exercise === "string" ? row.exercise.trim() : "";
    if (!name) {
      // No name means no session_exercise to point at. The row still belongs
      // to the day; it keeps session_exercise_id null rather than being filed
      // under an invented "Unknown" exercise.
      entry.unparsed += 1;
      continue;
    }
    const k = exerciseKey(name);
    if (!entry.exercises.has(k)) {
      entry.exercises.set(k, { key: k, displayName: name, rows: [] });
    }
    entry.exercises.get(k).rows.push(row);
  }

  const plan = [...days.values()];
  const totalExercises = plan.reduce((n, d) => n + d.exercises.size, 0);
  const alreadyLinked = sets.filter((r) => r.session_exercise_id).length;
  const unparsed = plan.reduce((n, d) => n + d.unparsed, 0);

  console.log("\nPLAN");
  console.log("  sessions to ensure:        " + plan.length);
  console.log("  session_exercises:         " + totalExercises);
  console.log("  sets to link:              " + (sets.length - alreadyLinked));
  console.log("  sets already linked:       " + alreadyLinked);
  console.log(
    "  sets with no exercise:     " + unparsed + " (stay unlinked, by design)"
  );
  console.log("");
  for (const d of plan) {
    console.log(
      "  " +
        d.day +
        "  " +
        String(d.rows.length).padStart(3) +
        " sets  " +
        String(d.exercises.size).padStart(2) +
        " exercises  " +
        [...d.exercises.values()].map((e) => e.displayName).join(", ")
    );
  }

  if (!APPLY) {
    console.log("\nDRY RUN - nothing written. Re-run with --apply.\n");
    return;
  }

  // ── write ──────────────────────────────────────────────────────────
  let sessionsCreated = 0;
  let exercisesCreated = 0;
  let setsLinked = 0;

  for (const d of plan) {
    const instants = d.rows.map((r) => Date.parse(r.performed_at));
    // The day's real span. For a backdated capture every row is the same
    // noon-IST marker, so start === end and no duration is claimed anywhere.
    const startedAt = new Date(Math.min(...instants)).toISOString();
    const endedAt = new Date(Math.max(...instants)).toISOString();

    // ON CONFLICT DO NOTHING against idx_workout_sessions_user_day, so a
    // re-run is a no-op rather than a duplicate or an error.
    const inserted = await rest("workout_sessions?on_conflict=user_id,performed_on", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          user_id: USER,
          performed_on: d.day,
          status: "completed",
          started_at: startedAt,
          ended_at: endedAt,
        },
      ]),
    });
    if (inserted && inserted.length > 0) sessionsCreated += 1;

    const [session] = await rest(
      "workout_sessions?select=id&user_id=eq." +
        USER +
        "&performed_on=eq." +
        d.day
    );
    if (!session) throw new Error("session missing after insert: " + d.day);

    const wanted = [...d.exercises.values()];
    if (wanted.length > 0) {
      const createdExercises = await rest(
        "session_exercises?on_conflict=session_id,exercise_key",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Prefer: "resolution=ignore-duplicates,return=representation",
          },
          body: JSON.stringify(
            wanted.map((e, i) => ({
              user_id: USER,
              session_id: session.id,
              display_name: e.displayName,
              exercise_key: e.key,
              position: i,
            }))
          ),
        }
      );
      exercisesCreated += createdExercises ? createdExercises.length : 0;
    }

    // Read back unconditionally: with ignore-duplicates a conflicting insert
    // returns nothing, so this is the only source of ids correct on both a
    // first run and a re-run.
    const linked = await rest(
      "session_exercises?select=id,exercise_key&session_id=eq." + session.id
    );
    const idByKey = new Map(linked.map((e) => [e.exercise_key, e.id]));

    for (const e of wanted) {
      const sessionExerciseId = idByKey.get(e.key);
      if (!sessionExerciseId) {
        throw new Error("no session_exercise for " + e.key + " on " + d.day);
      }
      // Only rows not already linked, so a re-run writes nothing and an
      // interrupted run picks up where it stopped.
      const ids = e.rows
        .filter((r) => !r.session_exercise_id)
        .map((r) => r.id);
      if (ids.length === 0) continue;

      await rest(
        "workout_sets?id=in.(" + ids.join(",") + ")&user_id=eq." + USER,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ session_exercise_id: sessionExerciseId }),
        }
      );
      setsLinked += ids.length;
    }

    console.log(
      "  ok  " + d.day + "  " + wanted.length + " exercises, session " + session.id
    );
  }

  console.log(
    "\nDONE - " +
      sessionsCreated +
      " sessions created, " +
      exercisesCreated +
      " session_exercises created, " +
      setsLinked +
      " sets linked."
  );
  console.log(
    "(Counts are what THIS run wrote; rows that already existed are skipped.)\n"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
