/**
 * Per-user frequency cap on the six routes that reach Groq.
 *
 * SCOPE — read this before trusting it for anything:
 * This is an IN-MEMORY, PER-INSTANCE counter. Vercel serverless instances do
 * not share memory, so a request landing on a cold instance starts from an
 * empty map. What this catches is a single runaway client loop hitting a warm
 * instance; what it does NOT catch is a distributed pattern spread across
 * instances. That is acceptable for a two-user app with closed signups, and
 * should be revisited before signups ever reopen — the durable version is a
 * counter table or a shared store, which is deliberately out of scope here.
 *
 * ONE counter per user across ALL AI routes, not one per route: hitting the
 * ceiling on PDF analysis also blocks note reformatting until the window
 * resets. The thing being bounded is total spend against one API key, and
 * six independent ceilings would multiply the real ceiling by six.
 *
 * WHAT IT COUNTS: one HTTP request to an AI route, checked at the handler.
 * It is NOT a Groq-call quota. /api/pdf/analyze issues up to 4 sequential
 * Groq calls per request (smart mode) and the two YouTube routes up to 6
 * (one per transcript chunk), so the real per-window Groq ceiling is a
 * multiple of MAX_REQUESTS_PER_WINDOW. Bounding token spend per call is the
 * job of the max_tokens/input caps already on those paths; this bounds how
 * often the paths can be entered at all.
 */

/** Rolling window. Requests older than this stop counting. */
const WINDOW_MS = 60_000;

/**
 * Requests per user per window, across all six AI routes combined.
 *
 * 20, not the 10 this started as, because of one specific legitimate burst:
 * logWorkoutMutationOptions is registered offline-resumable
 * (lib/offline-mutations.ts), so a gym session logged without signal replays
 * as N concurrent POSTs to /api/workouts the moment connectivity returns.
 * Mutations run retry: 3 with TanStack's ~1s/2s/4s backoff (app/providers.tsx),
 * which means every retry of a rejected replay lands inside the SAME 60s
 * window and also fails — and POST /api/workouts returns 429 before it
 * inserts, so the capture is lost outright. That route's whole design says
 * losing what the user typed is never an acceptable outcome, and a ceiling of
 * 10 would put a 12-exercise offline session straight into it.
 *
 * 20 clears the largest realistic burst with headroom while staying far below
 * anything a runaway loop produces (those fire at network speed — hundreds per
 * minute), so the abuse case it exists to catch is caught identically. Every
 * interactive path is nowhere near either number: each AI request is a 2–60s
 * round-trip behind an in-flight lock in its UI.
 *
 * NOTE this does not fully solve the offline-replay case — a session with more
 * than 20 queued captures still loses the overflow. See the PR description.
 */
const MAX_REQUESTS_PER_WINDOW = 20;

/**
 * Backstop on the map itself. Entries are pruned lazily per user on their own
 * next check, so a user who never returns would otherwise hold their array
 * forever. Irrelevant at two users; present so this can't become a slow leak
 * on a long-lived warm instance if the user count ever grows.
 */
const MAX_TRACKED_USERS = 5000;

/** userId -> ascending timestamps (ms) of requests inside the window. */
const recentRequests = new Map<string, number[]>();

export type AiRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/** Drop every user whose requests have all aged out. */
function sweepStaleUsers(cutoff: number): void {
  // Array.from: tsconfig has no `target`, so Map iterators can't be for…of'd.
  for (const userId of Array.from(recentRequests.keys())) {
    const timestamps = recentRequests.get(userId);
    if (!timestamps || timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
      recentRequests.delete(userId);
    }
  }
}

/**
 * Record one AI request for `userId` and say whether it may proceed.
 *
 * Call this ONCE per request, at the top of the handler after the auth check
 * and before any Groq call. An allowed call is recorded; a rejected one is
 * not, so being blocked never extends the block.
 */
export function checkAiRateLimit(userId: string): AiRateLimitResult {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  if (recentRequests.size > MAX_TRACKED_USERS) sweepStaleUsers(cutoff);

  // Timestamps are appended in order, so everything at or below the cutoff is
  // a prefix — but filter is clearer than an index search at this size.
  const timestamps = (recentRequests.get(userId) ?? []).filter((t) => t > cutoff);

  if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    // Keep the pruned array so the next check doesn't re-filter the same tail.
    recentRequests.set(userId, timestamps);
    // The oldest request in the window is the first one to age out, which is
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
}

/** The user-facing 429 message. One wording across all six routes. */
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

/** Test-only: clear all counters. Not called by application code. */
export function __resetAiRateLimit(): void {
  recentRequests.clear();
}
