import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import toast from "react-hot-toast";

import { invalidateDerivedCaches } from "@/lib/derived-caches";
import type { FocusSession } from "@/types/database";

const FOCUS_KEY = ["focus-sessions"] as const;

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

async function request<T>(method: string, body?: unknown): Promise<T> {
  const res = await fetch("/api/focus", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!res.ok || json.error || json.data === null) {
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  return json.data;
}

// Exported so DataPrefetcher can warm this cache with the exact same queryFn.
export const focusQueryOptions = {
  queryKey: FOCUS_KEY,
  queryFn: () => request<FocusSession[]>("GET"),
  staleTime: 5 * 60 * 1000,
  gcTime: 10 * 60 * 1000,
};

/** Last 5 focus sessions, newest first. */
export function useRecentFocusSessions() {
  return useQuery(focusQueryOptions);
}

/** Create a session row when the timer starts; returns the row (for its id). */
export function useCreateFocusSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { category: string; duration_minutes: number }) =>
      request<FocusSession>("POST", input),
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Failed to start session"
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: FOCUS_KEY }),
  });
}

/** Mark a session ended (completed or stopped early). */
export function useEndFocusSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; completed: boolean }) =>
      request<FocusSession>("PATCH", input),
    // Analytics only count completed=true sessions, so session START doesn't
    // need this — only ending one can change the derived numbers.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: FOCUS_KEY });
      invalidateDerivedCaches(qc, "focus");
    },
  });
}
