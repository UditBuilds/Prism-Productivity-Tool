"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";

import pkg from "@/package.json";
import {
  createIDBPersister,
  dropLegacySharedCache,
  PERSISTED_QUERY_KEYS,
} from "@/lib/query-persister";
import { isResumableMutationKey } from "@/lib/offline-mutations";

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
        void queryClient.resumePausedMutations();
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
