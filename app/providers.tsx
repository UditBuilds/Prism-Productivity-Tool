"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "react-hot-toast";

import { registerResumableMutations } from "@/lib/offline-mutations";
import { ThemeProvider } from "@/components/providers/ThemeProvider";

// Persistence is NOT wired here on purpose. The root provider mounts before
// anyone is authenticated, so restoring a snapshot at this level could leak
// one user's data into another's session on a shared browser. The dashboard
// layout mounts components/providers/PersistBoundary with the signed-in
// user's id, and persistence is scoped there.
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          // Explicit default (was the implicit TanStack 5-min default).
          // Per-query overrides (reminders, plans, …) still win.
          gcTime: 10 * 60 * 1000,
          refetchOnWindowFocus: false,
          retry: 1,
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
