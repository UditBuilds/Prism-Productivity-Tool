/**
 * "This mutation changed data a Server Component renders" — as a declarative
 * property of the mutation instead of a callback at the call site.
 *
 * WHY NOT A CALLBACK. The dashboard is a Server Component, so a query
 * invalidation cannot move its counters or its agenda; only router.refresh()
 * re-runs the server queries. CaptureField used to pass `onSettled` at each
 * .mutate() call, and `onSettled` fires on FAILURE too: with the server
 * unreachable but navigator.onLine still true, the mutation exhausted its
 * three retries, the hook rolled back and toasted correctly — and then the
 * refresh ran anyway, tried to re-fetch the route from a dead server, and Next
 * fell back to a hard reload that landed on the browser's network-error page.
 * A blank screen, from a capture that had already been reported as failed.
 *
 * WHY NOT onSuccess AT THE CALL SITE EITHER. Callbacks handed to .mutate() are
 * not part of the mutation — dehydrateMutation serialises only
 * {mutationKey, state, scope, meta} — so anything hung off the call site is
 * gone the moment a queued capture is replayed after a reload. `meta` is the
 * one channel on that list that a call site can set and a replay still
 * carries.
 *
 * WHY THE MUTATION CACHE. Only MutationCache config callbacks are handed the
 * mutation object (query-core mutation.js: the cache-level onSuccess receives
 * `this` as its fourth argument), so they are the only layer that can read
 * meta. A per-key setMutationDefaults handler cannot — its onSuccess gets no
 * mutation — and would in any case be overridden by the live useMutation's own
 * handlers. app/providers.tsx wires the single handler; this module is the
 * bridge it needs to reach a router it cannot import.
 */

/**
 * The App Router's refresh, published by a client component that has one.
 * Module scope is the right lifetime: it survives client-side navigation and
 * resets on a full reload, exactly like the query cache it is paired with.
 */
let refreshServerData: (() => void) | null = null;
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Multiple successes inside this window produce ONE refresh.
 *
 * Not premature tuning — it is the reconnect case. PersistBoundary already
 * refreshes once after draining the paused queue, and every replayed capture
 * in that queue also asks for one, so a gym session queued offline would
 * otherwise re-fetch the whole dashboard once per set. 120ms is long enough to
 * swallow a burst and short enough that a single online capture still feels
 * immediate.
 */
const COALESCE_MS = 120;

/**
 * Publish a refresh function. Returns the unsubscribe, so the owning component
 * can clear it on unmount and a pending refresh can never fire into a torn-down
 * tree.
 */
export function registerServerDataRefresh(fn: () => void): () => void {
  refreshServerData = fn;
  return () => {
    if (refreshServerData !== fn) return;
    refreshServerData = null;
    if (coalesceTimer) {
      clearTimeout(coalesceTimer);
      coalesceTimer = null;
    }
  };
}

/**
 * Ask for a refresh. A no-op when nothing is registered — which is the correct
 * outcome outside the authenticated tree (a login page has no server data of
 * the user's to re-fetch) rather than an error to handle.
 */
export function requestServerDataRefresh(): void {
  if (!refreshServerData) return;
  if (coalesceTimer) return;
  coalesceTimer = setTimeout(() => {
    coalesceTimer = null;
    refreshServerData?.();
  }, COALESCE_MS);
}

/**
 * Types the `meta` bag app-wide. TanStack leaves MutationMeta as
 * Record<string, unknown> unless Register is augmented, which would make a typo
 * in this flag name a silent no-op at both ends — the one failure mode a
 * refresh flag must not have. Nothing else in the app uses meta.
 */
declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /**
       * Set by call sites whose result is rendered by a Server Component.
       * Read ONLY by the MutationCache onSuccess handler in app/providers.tsx,
       * so it fires for an online success and for an offline replay alike, and
       * never on failure.
       */
      refreshServerData?: true;
    };
  }
}

/** The opt-in, as one shared object so the flag is spelled once. */
export const REFRESH_SERVER_DATA = { refreshServerData: true } as const;
