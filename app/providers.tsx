"use client";

import { useState } from "react";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "react-hot-toast";

import { registerResumableMutations } from "@/lib/offline-mutations";
import { requestServerDataRefresh } from "@/lib/rsc-refresh";
import { ThemeProvider } from "@/components/providers/ThemeProvider";

// Persistence is NOT wired here on purpose. The root provider mounts before
// anyone is authenticated, so restoring a snapshot at this level could leak
// one user's data into another's session on a shared browser. The dashboard
// layout mounts components/providers/PersistBoundary with the signed-in
// user's id, and persistence is scoped there.
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    const qc = new QueryClient({
      // ONE place decides that a mutation's result needs the Server Components
      // re-rendered, and it is here rather than at any call site.
      //
      // This is the only callback layer handed the mutation object, so it is
      // the only one that can read `meta` — options.onSuccess is not, and a
      // per-key setMutationDefaults handler would additionally be overridden by
      // the live useMutation. Being on the CACHE also means it fires for a
      // mutation resumed from IndexedDB after a reload, whose call-site
      // callbacks no longer exist; `meta` is dehydrated alongside
      // mutationKey/state/scope, so the flag survives that trip.
      //
      // onSuccess, deliberately NOT onSettled. A failed capture has already
      // been rolled back and toasted by its own hook; refreshing after it was
      // the blank-page bug — see lib/rsc-refresh.ts.
      mutationCache: new MutationCache({
        onSuccess: (_data, _variables, _context, mutation) => {
          if (mutation.meta?.refreshServerData) requestServerDataRefresh();
        },
      }),
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          // Explicit default (was the implicit TanStack 5-min default).
          // Per-query overrides (reminders, plans, …) still win.
          gcTime: 10 * 60 * 1000,
          refetchOnWindowFocus: false,
          retry: 1,
        },
        mutations: {
          // Both of these are load-bearing for offline, and only together.
          //
          // The default networkMode 'online' gates on onlineManager.isOnline(),
          // which stays TRUE on iOS in airplane mode — so the mutation ran, the
          // fetch threw, and it settled as an error. Never paused means never
          // persisted to IndexedDB, so the change was simply lost.
          // 'offlineFirst' lets the attempt proceed and, when the fetch fails
          // with no connection, hands it to the retryer instead.
          //
          // retry must then be > 0: at the mutation default of 0 the retryer
          // rejects on the first failure and never reaches the branch that
          // pauses. One retry is enough to get there in a lab; three retries
          // (with TanStack's default exponential backoff — ~1s, 2s, 4s) bridge
          // the iOS reconnect race where the online event fires before the
          // network interface is usable, and retry 1 drains inside that window.
          networkMode: "offlineFirst",
          retry: 3,
        },
      },
    });
    // Default mutationFns so offline-queued mutations can resume after a
    // reload. Must be registered before any restore/resume can run.
    registerResumableMutations(qc);
    return qc;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>{children}</ThemeProvider>
      <Toaster
        position="bottom-center"
        toastOptions={{
          style: {
            background: "#1A1A1A",
            color: "#ffffff",
            border: "1px solid #2A2A2A",
            borderRadius: "12px",
            fontSize: "14px",
            padding: "12px 16px",
            maxWidth: "340px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
          },
          duration: 4000,
        }}
        containerStyle={{
          bottom: "calc(72px + env(safe-area-inset-bottom, 16px))",
        }}
      />
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
