"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useRouter } from "next/navigation";

import pkg from "@/package.json";
import {
  createIDBPersister,
  dropLegacySharedCache,
  PERSISTED_QUERY_KEYS,
} from "@/lib/query-persister";
import { isResumableMutationKey } from "@/lib/offline-mutations";
import { registerServerDataRefresh } from "@/lib/rsc-refresh";

/**
 * Tracks which user's data the in-memory query cache belongs to. Module
 * scope is exactly the right lifetime: it survives client-side navigation
 * (like the cache itself) and resets on a full reload (when the cache is
 * empty anyway).
 */
let cacheOwner: string | null = null;

/**
 * The signed-in user's id, for client components that need to SCOPE something
 * to the account rather than merely display it.
 *
 * It lives here rather than in its own provider because this boundary already
 * has exactly the right lifetime: it wraps the whole authenticated segment and
 * is keyed by user.id, so the context cannot outlive or lag the account it
 * describes. Anything reading it inherits the account-switch protection above
 * for free.
 *
 * Null outside the dashboard segment, which is why useUserId() returns
 * `string | null` rather than throwing — a shared component may render on both
 * sides of the auth boundary.
 */
const UserIdContext = createContext<string | null>(null);

export function useUserId(): string | null {
  return useContext(UserIdContext);
}

/**
 * Mounts React Query persistence INSIDE the authenticated dashboard segment,
 * scoped to the signed-in user. The root provider stays persistence-free on
 * purpose: restore must never run before we know who is logged in, or one
 * user's IndexedDB snapshot could hydrate into another's session.
 *
 * Also the safety net for account switches that never hit the logout button
 * (expired session → another user signs in): the render-phase owner check
 * wipes the shared in-memory cache before any child can observe it.
 *
 * Mount with key={userId} so a user change remounts the boundary and its
 * persister/restore run fresh for the new account.
 */
export function PersistBoundary({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();

  // Render-phase on purpose: children must never render (not even one frame)
  // against another account's cache. Idempotent, so Strict Mode double
  // rendering is harmless.
  if (cacheOwner !== null && cacheOwner !== userId) {
    queryClient.clear();
  }
  cacheOwner = userId;

  const [persister] = useState(() => createIDBPersister(userId));

  // The pre-scoping release wrote one SHARED snapshot with no owner; make
  // sure it can never be restored for anyone.
  useEffect(() => {
    void dropLegacySharedCache();
  }, []);

  // Publish this segment's router.refresh so the MutationCache handler in
  // app/providers.tsx can reach it. That handler lives outside React and has no
  // router; this boundary already owns "re-run the Server Components after a
  // queued write lands" (below), so refresh plumbing stays in one file.
  //
  // Registered HERE rather than in CaptureField because the refresh is not the
  // dashboard's alone: a capture replayed from the offline queue can land while
  // the user is on any authenticated route, and this boundary wraps all of
  // them. Unregistering on unmount means a coalesced refresh can never fire
  // into a torn-down tree.
  useEffect(() => registerServerDataRefresh(() => router.refresh()), [router]);

  // When connectivity returns after an offline period, replay any paused
  // mutations that were waiting at mount time (or accumulated since).  Once
  // they land, bust the Router Cache so Server Components pick up the new
  // data — the mount-time resumePausedMutations could not do this because
  // its promise stays pending while offline.
  //
  // TanStack's own onlineManager subscriber (registered in QueryClient.mount)
  // also calls resumePausedMutations — ours fires independently.  Whichever
  // runs first drains the paused queue; the second finds zero paused
  // mutations and is a no-op.  Both subscribers are cleaned up on unmount.
  //
  // THE REFRESH IS GATED ON A SUCCEEDED WRITE, NOT ON THE ONLINE SIGNAL.
  // "The interface came back" and "the origin can answer" are different
  // facts, and only the second one makes router.refresh() safe. Refreshing on
  // the first destroyed the app outright: Next's fetchServerResponse catches a
  // failed RSC fetch and returns the URL as a *string*, the refresh reducer
  // reads that as an external URL, and app-router assigns window.location —
  // a hard navigation onto the browser's native error page, taking the React
  // tree, the in-memory cache and any open sheet with it. Reproduced against a
  // genuinely dead server: online → 15.5s → chrome-error://chromewebdata.
  //
  // The awaited resume cannot be the evidence. query-core resumes with
  // `mutation.continue().catch(noop)` (mutationCache.js), so the promise
  // settles identically whether the server replied or refused the connection.
  // A mutation that reached "success" is the proof instead — it means the
  // origin answered a moment ago, which is the same standing every other
  // router.refresh() in this app already has (they all follow a completed
  // write). It is the right trigger on meaning too, not just on safety: if
  // nothing succeeded, no server-rendered data changed, so there is nothing
  // to re-fetch. A failed replay is already rolled back and toasted by its own
  // hook — see lib/rsc-refresh.ts for the same rule at the MutationCache.
  //
  // Deliberately NOT a health-check preflight: an extra GET on every reconnect
  // still races (it can pass microseconds before the server dies) and would
  // only narrow a window this closes by construction.
  useEffect(() => {
    const unsub = onlineManager.subscribe(async (online) => {
      if (!online) return;
      // Hold the Mutation objects, not a count: query-core reassigns
      // `state` on the same instance, so these read fresh after the await
      // and tell us what actually happened to each one.
      const resumed = queryClient
        .getMutationCache()
        .getAll()
        .filter((m) => m.state.isPaused);
      if (resumed.length === 0) return;
      await queryClient.resumePausedMutations();
      if (resumed.some((m) => m.state.status === "success")) {
        router.refresh();
      }
    });
    return () => unsub();
  }, [queryClient, router]);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        // Snapshots older than a day are dropped on restore, not shown.
        maxAge: 24 * 60 * 60 * 1000,
        // Version busts stale data shapes; userId is belt-and-braces so even
        // a mis-keyed snapshot can never hydrate across accounts.
        buster: `${pkg.version}:${userId}`,
        dehydrateOptions: {
          // Whitelist: only the 5 offline-worthy caches are persisted.
          shouldDehydrateQuery: (query) =>
            query.state.status === "success" &&
            PERSISTED_QUERY_KEYS.has(String(query.queryKey[0])),
          // Only offline-paused mutations with a registered default
          // mutationFn survive a reload — anything else would resume into a
          // guaranteed "no mutationFn" failure.
          shouldDehydrateMutation: (mutation) =>
            mutation.state.isPaused &&
            isResumableMutationKey(mutation.options.mutationKey),
        },
      }}
      onSuccess={() => {
        // After restore, fire anything that was queued before the reload.
        // If offline, these re-pause immediately and wait for connectivity
        // (see the onlineManager subscriber below).
        void queryClient.resumePausedMutations();
      }}
    >
      <UserIdContext.Provider value={userId}>{children}</UserIdContext.Provider>
    </PersistQueryClientProvider>
  );
}
