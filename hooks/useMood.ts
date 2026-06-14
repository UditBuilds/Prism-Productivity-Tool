import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import toast from "react-hot-toast";

import { istDateString } from "@/lib/date";
import { invalidateDerivedCaches } from "@/lib/derived-caches";
import type { MoodLog, MoodValue } from "@/types/database";

const MOOD_KEY = ["mood-logs"] as const;

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

async function request<T>(method: string, body?: unknown): Promise<T> {
  const res = await fetch("/api/mood", {
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

const fetchHistory = () => request<MoodLog[]>("GET");

// Exported so DataPrefetcher can warm this cache with the exact same queryFn.
export const moodQueryOptions = {
  queryKey: MOOD_KEY,
  queryFn: fetchHistory,
  staleTime: 10 * 60 * 1000,
  gcTime: 20 * 60 * 1000,
};

/** Last 30 mood logs, newest first. */
export function useMoodHistory() {
  return useQuery(moodQueryOptions);
}

/** Today's (IST) log, or null. Derived from the shared cache. */
export function useTodaysMood() {
  return useQuery<MoodLog[], Error, MoodLog | null>({
    ...moodQueryOptions,
    select: (logs) =>
      logs.find((l) => l.logged_date === istDateString()) ?? null,
  });
}

/** Upsert today's mood with an optimistic cache update. */
export function useLogMood() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { mood: MoodValue; note?: string | null }) =>
      request<MoodLog>("POST", input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: MOOD_KEY });
      const previous = qc.getQueryData<MoodLog[]>(MOOD_KEY) ?? [];
      const today = istDateString();
      const existing = previous.find((l) => l.logged_date === today);
      const optimistic: MoodLog = existing
        ? { ...existing, mood: input.mood, note: input.note ?? null }
        : {
            id: `optimistic-${crypto.randomUUID()}`,
            user_id: "optimistic",
            mood: input.mood,
            note: input.note ?? null,
            logged_date: today,
            created_at: new Date().toISOString(),
          };
      qc.setQueryData<MoodLog[]>(MOOD_KEY, [
        optimistic,
        ...previous.filter((l) => l.logged_date !== today),
      ]);
      return { previous };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(MOOD_KEY, ctx.previous);
      toast.error(err instanceof Error ? err.message : "Failed to log mood");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: MOOD_KEY });
      invalidateDerivedCaches(qc, "mood");
    },
  });
}
