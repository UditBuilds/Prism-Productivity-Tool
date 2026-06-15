"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "react-hot-toast";

import { ThemeProvider } from "@/components/providers/ThemeProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

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
