"use client";

import { useEffect, useState } from "react";
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
  useEffect(() => {
    const unsub = onlineManager.subscribe(async (online) => {
      if (!online) return;
      const hasPaused =
        queryClient
          .getMutationCache()
          .getAll()
          .filter((m) => m.state.isPaused).length > 0;
      await queryClient.resumePausedMutations();
      if (hasPaused) {
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
      {children}
    </PersistQueryClientProvider>
  );
}
