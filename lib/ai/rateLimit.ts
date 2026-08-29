/**
 * Per-user frequency caps on the routes that reach Groq.
 *
 * SCOPE — read this before trusting it for anything:
 * These are IN-MEMORY, PER-INSTANCE counters. Vercel serverless instances do
 * not share memory, so a request landing on a cold instance starts from an
 * empty map. What this catches is a single runaway client loop hitting a warm
 * instance; what it does NOT catch is a distributed pattern spread across
 * instances. That is acceptable for a two-user app with closed signups, and
 * should be revisited before signups ever reopen — the durable version is a
 * counter table or a shared store, which is deliberately out of scope here.
 *
 * THREE TIERS, and every split is deliberate:
 *
 *   checkAiRateLimit       — 20/60s, ONE budget shared by the five routes a
 *                            user drives by hand (notes/reformat,
 *                            srs/generate, pdf/analyze, youtube/analyze,
 *                            youtube/notes/start).
 *   checkWorkoutRateLimit  — 100/60s, a SEPARATE budget for /api/workouts.
 *   checkYoutubeContinueRateLimit
 *                          — 100/60s, a SEPARATE budget for
 *                            /api/youtube/notes/continue.
 *
 * The three are fully decoupled: exhausting one leaves the others untouched.
 * See MAX_WORKOUT_REQUESTS_PER_WINDOW for why workouts can't share the low
 * ceiling — a rejection there destroys user input, which is not true of the
 * other five.
 *
 * WHAT THEY COUNT: one HTTP request to an AI route, checked at the handler.
 * NOT a Groq-call quota. /api/pdf/analyze issues up to 4 sequential Groq calls
 * per request (smart mode) and /api/youtube/analyze up to 6 (one per sampled
 * transcript chunk), so the real per-window Groq ceiling on the shared tier is
 * a multiple of its limit. The note-job routes are the exception and are 1:1 —
 * /start makes no Groq call at all and /continue makes exactly one. Bounding token spend per call is the job of the
 * max_tokens/input caps already on those paths; these bound how often the
 * paths can be entered at all.
 */

/** Rolling window for both tiers. Requests older than this stop counting. */
const WINDOW_MS = 60_000;

/**
 * Shared ceiling for the five content-generation routes.
 *
 * Every one of those five is interactive and idempotent-ish: the request is
 * behind an in-flight lock in its UI, each round-trip is 2–60s, and a
 * rejection costs the user a retry click — it does not destroy anything they
 * typed. 20 is far above any interactive rate and far below what a runaway
 * loop produces (those fire at network speed, hundreds per minute).
 *
 * DO NOT raise this to accommodate /api/workouts. That route has its own
 * counter precisely so this number can stay tight.
 */
const MAX_REQUESTS_PER_WINDOW = 20;

/**
 * Ceiling for /api/workouts alone.
 *
 * WHY THIS ROUTE IS DIFFERENT: POST /api/workouts returns 429 before it
 * inserts, so a rejected capture is LOST — not deferred. The route is built
 * around the opposite guarantee (it stores an unparsed row rather than lose
 * what the user typed when Groq itself fails), and the loss is not recoverable
 * by retry: logWorkout is offline-resumable (lib/offline-mutations.ts) and
 * `request()` in hooks/useWorkouts.ts throws on ANY non-OK response, so a 429
 * is indistinguishable from a network failure to the retryer. It retries 3x
 * with TanStack's ~1s/2s/4s backoff (app/providers.tsx) — every attempt lands
 * inside the SAME 60s window and also fails. Four rejections, capture gone.
 *
 * So the ceiling has to sit above the worst legitimate burst, not merely above
 * the typical one. A gym session logged with no signal replays as N concurrent
 * POSTs the moment connectivity returns.
 *
 * HOW 100 WAS CHOSEN — this is a reasoned estimate, NOT fitted to real data.
 * At the time of writing the entire workout history is 3 captures, all inside
 * one 49-second stretch on 2026-08-04 (17s and 32s apart, one exercise each).
 * That is enough to show interactive logging runs at ~2-4 requests/minute and
 * nowhere near any ceiling, and nothing else. There is no session-size history
 * to fit a percentile to.
 *
 * The bound therefore comes from the largest session this codebase itself
 * documents: the "12-exercise / 44-set session" measured for the MAX_TOKENS
 * comment in lib/ai/workout.ts. Logged per exercise that is ~12 requests;
 * logged per set — which the UI permits, one capture per line — it is 44.
 * 100 clears 44 with better than 2x headroom, which absorbs two queued
 * sessions or a correction pass re-logged on top of one.
 *
 * Still bounded, not "unlimited": worst case this route can spend is 100 Groq
 * calls per minute per instance, and it is the CHEAPEST AI path in the app —
 * one call per request against a 2000-char input with max_tokens 2000, versus
 * pdf/analyze's 4 calls and the YouTube routes' 6. A genuine runaway loop
 * issues thousands per minute and is still cut off hard.
 *
 * If real sessions ever show more than ~50 captures in a minute, revisit this
 * with the data rather than nudging the number again.
 */
const MAX_WORKOUT_REQUESTS_PER_WINDOW = 100;

/**
 * Ceiling for /api/youtube/notes/continue alone.
 *
 * WHY THIS ROUTE CANNOT SHARE THE 20/60s TIER: a continuation is not a user
 * action. One note job is N sequential /continue calls, one per transcript
 * chunk, issued by the client's poll loop — a 40-minute video is ~15 of them
 * and a 2-hour lecture ~45. Every one of those would land on the shared budget
 * and, at 20/60s, a single long video would exhaust it partway through and
 * then block itself. Worse, it would also block the four genuinely interactive
 * routes that share that budget (notes/reformat, srs/generate, pdf/analyze,
 * youtube/analyze) for the rest of the minute — generating one note would stop
 * the user making a flashcard.
 *
 * The entry point stays governed: POST /api/youtube/notes/start is on the
 * shared 20/60s tier, so a user still cannot kick off more than 20 jobs a
 * minute. This tier bounds the follow-through of jobs that were already
 * allowed to begin.
 *
 * WHY 100. The client polls one chunk at a time and awaits each response, so a
 * single job's real rate is bounded by round-trip latency (a Groq call per
 * chunk, seconds each) — nowhere near 100/min. 100 leaves room for several
 * concurrent jobs, or a resumed job racing a fresh one, while still cutting off
 * a runaway loop hard: a broken client firing at network speed does hundreds
 * per minute.
 *
 * Cost is bounded by construction, not just by this number: /continue makes
 * exactly ONE Groq call per request, and a job stops calling entirely once
 * completed_chunks + chunks_failed reaches total_chunks — a client that keeps
 * polling a finished job gets the completed row back without touching Groq.
 */
const MAX_YOUTUBE_CONTINUE_REQUESTS_PER_WINDOW = 100;

/**
 * Backstop on each map. Entries are pruned lazily per user on their own next
 * check, so a user who never returns would otherwise hold their array forever.
 * Irrelevant at two users; present so this can't become a slow leak on a
 * long-lived warm instance if the user count ever grows.
 */
const MAX_TRACKED_USERS = 5000;

export type AiRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

interface RateLimiter {
  check(userId: string): AiRateLimitResult;
  /** Test-only: requests currently inside the window for this user. */
  peek(userId: string): number;
  /** Test-only. */
  reset(): void;
}

/**
 * One independent sliding-window counter. Each call to this factory gets its
 * own Map, so tiers built from it cannot influence each other's budgets.
 */
function createRateLimiter(maxPerWindow: number): RateLimiter {
  /** userId -> ascending timestamps (ms) of requests inside the window. */
  const recentRequests = new Map<string, number[]>();

  /** Drop every user whose requests have all aged out. */
  function sweepStaleUsers(cutoff: number): void {
    // Array.from: tsconfig has no `target`, so Map iterators can't be for…of'd.
    for (const userId of Array.from(recentRequests.keys())) {
      const timestamps = recentRequests.get(userId);
      if (
        !timestamps ||
        timestamps.length === 0 ||
        timestamps[timestamps.length - 1] <= cutoff
      ) {
        recentRequests.delete(userId);
      }
    }
  }

  return {
    check(userId: string): AiRateLimitResult {
      const now = Date.now();
      const cutoff = now - WINDOW_MS;

      if (recentRequests.size > MAX_TRACKED_USERS) sweepStaleUsers(cutoff);

      // Timestamps are appended in order, so everything at or below the cutoff
      // is a prefix — but filter is clearer than an index search at this size.
      const timestamps = (recentRequests.get(userId) ?? []).filter(
        (t) => t > cutoff
      );

      if (timestamps.length >= maxPerWindow) {
        // Keep the pruned array so the next check doesn't re-filter the tail.
        recentRequests.set(userId, timestamps);
        // The oldest request in the window is the first to age out, which is
        // when a slot frees. Ceil to whole seconds, floor at 1 — Retry-After: 0
        // reads as "retry immediately", which is exactly wrong here.
        const freesAt = timestamps[0] + WINDOW_MS;
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((freesAt - now) / 1000)),
        };
      }

      timestamps.push(now);
      recentRequests.set(userId, timestamps);
      return { allowed: true };
    },

    peek(userId: string): number {
      const cutoff = Date.now() - WINDOW_MS;
      return (recentRequests.get(userId) ?? []).filter((t) => t > cutoff).length;
    },

    reset(): void {
      recentRequests.clear();
    },
  };
}

const sharedLimiter = createRateLimiter(MAX_REQUESTS_PER_WINDOW);
const workoutLimiter = createRateLimiter(MAX_WORKOUT_REQUESTS_PER_WINDOW);
const youtubeContinueLimiter = createRateLimiter(
  MAX_YOUTUBE_CONTINUE_REQUESTS_PER_WINDOW
);

/**
 * Record one request against the SHARED five-route budget and say whether it
 * may proceed. Used by notes/reformat, srs/generate, pdf/analyze,
 * youtube/analyze and youtube/notes.
 *
 * Call ONCE per request, after the auth check and before any Groq call. An
 * allowed call is recorded; a rejected one is not, so being blocked never
 * extends the block.
 */
export function checkAiRateLimit(userId: string): AiRateLimitResult {
  return sharedLimiter.check(userId);
}

/**
 * Record one request against the /api/workouts budget. Same contract as
 * checkAiRateLimit, separate counter and a much higher ceiling — see
 * MAX_WORKOUT_REQUESTS_PER_WINDOW.
 */
export function checkWorkoutRateLimit(userId: string): AiRateLimitResult {
  return workoutLimiter.check(userId);
}

/**
 * Record one request against the /api/youtube/notes/continue budget. Same
 * contract as checkAiRateLimit, separate counter, higher ceiling — see
 * MAX_YOUTUBE_CONTINUE_REQUESTS_PER_WINDOW. Exhausting this leaves the shared
 * interactive tier untouched, which is the entire point of the split.
 */
export function checkYoutubeContinueRateLimit(
  userId: string
): AiRateLimitResult {
  return youtubeContinueLimiter.check(userId);
}

/** The user-facing 429 message. One wording across every AI route. */
export function aiRateLimitMessage(retryAfterSeconds: number): string {
  return `Too many AI requests in a short time. Try again in ${retryAfterSeconds} second${
    retryAfterSeconds === 1 ? "" : "s"
  }.`;
}

/** Retry-After (RFC 9110 delta-seconds form) for a 429 response. */
export function aiRateLimitHeaders(
  retryAfterSeconds: number
): Record<string, string> {
  return { "Retry-After": String(retryAfterSeconds) };
}

/** The configured ceilings, for tests and diagnostics. */
export const AI_RATE_LIMITS = {
  windowMs: WINDOW_MS,
  shared: MAX_REQUESTS_PER_WINDOW,
  workouts: MAX_WORKOUT_REQUESTS_PER_WINDOW,
  youtubeContinue: MAX_YOUTUBE_CONTINUE_REQUESTS_PER_WINDOW,
} as const;

/** Test-only: requests currently in-window per tier. Not called by app code. */
export function __peekAiRateLimit(userId: string): {
  shared: number;
  workouts: number;
  youtubeContinue: number;
} {
  return {
    shared: sharedLimiter.peek(userId),
    workouts: workoutLimiter.peek(userId),
    youtubeContinue: youtubeContinueLimiter.peek(userId),
  };
}

/** Test-only: clear both counters. Not called by application code. */
export function __resetAiRateLimit(): void {
  sharedLimiter.reset();
  workoutLimiter.reset();
  youtubeContinueLimiter.reset();
}
