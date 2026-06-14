import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import toast from "react-hot-toast";

import type { Countdown } from "@/types/database";

const COUNTDOWNS_KEY = ["countdowns"] as const;

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

async function request<T>(method: string, body?: unknown): Promise<T> {
  const res = await fetch("/api/countdowns", {
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

export function useCountdownsQuery() {
  return useQuery<Countdown[]>({
    queryKey: COUNTDOWNS_KEY,
    queryFn: () => request<Countdown[]>("GET"),
    staleTime: 15 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

export function useCreateCountdown() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; target_date: string; emoji: string }) =>
      request<Countdown>("POST", input),
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Failed to create countdown"
      ),
    onSuccess: () => toast.success("Countdown created"),
    onSettled: () => qc.invalidateQueries({ queryKey: COUNTDOWNS_KEY }),
  });
}

export function useDeleteCountdown() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<{ id: string }>("DELETE", { id }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: COUNTDOWNS_KEY });
      const previous = qc.getQueryData<Countdown[]>(COUNTDOWNS_KEY) ?? [];
      qc.setQueryData<Countdown[]>(
        COUNTDOWNS_KEY,
        previous.filter((c) => c.id !== id)
      );
      return { previous };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(COUNTDOWNS_KEY, ctx.previous);
      toast.error(
        err instanceof Error ? err.message : "Failed to delete countdown"
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: COUNTDOWNS_KEY }),
  });
}
