import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import toast from "react-hot-toast";

import { invalidateDerivedCaches } from "@/lib/derived-caches";
import type { Reminder } from "@/types/database";

const REMINDERS_KEY = ["reminders"] as const;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface CreateReminderInput {
  title: string;
  body?: string | null;
  remind_at: string;
  task_id?: string | null;
  note_id?: string | null;
}

export interface UpdateReminderInput {
  id: string;
  title?: string;
  body?: string | null;
  remind_at?: string;
  is_sent?: boolean;
  task_id?: string | null;
  note_id?: string | null;
}

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

async function request<T>(method: string, body?: unknown): Promise<T> {
  const res = await fetch("/api/reminders", {
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
export const remindersQueryOptions = {
  queryKey: REMINDERS_KEY,
  queryFn: () => request<Reminder[]>("GET"),
  staleTime: 3 * 60 * 1000,
  gcTime: 6 * 60 * 1000,
};

export function useRemindersQuery() {
  return useQuery(remindersQueryOptions);
}

/**
 * Pending reminders due within the next 7 days (remind_at > now, is_sent false).
 * Shares the ["reminders"] cache via `select` — no extra network request.
 */
export function useUpcomingReminders() {
  return useQuery<Reminder[], Error, Reminder[]>({
    ...remindersQueryOptions,
    select: (reminders) => {
      const now = Date.now();
      const horizon = now + SEVEN_DAYS_MS;
      return reminders.filter((r) => {
        const at = new Date(r.remind_at).getTime();
        return !r.is_sent && at > now && at <= horizon;
      });
    },
  });
}

export function useCreateReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReminderInput) =>
      request<Reminder>("POST", input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: REMINDERS_KEY });
      const previous = qc.getQueryData<Reminder[]>(REMINDERS_KEY) ?? [];
      const optimistic: Reminder = {
        id: `optimistic-${crypto.randomUUID()}`,
        user_id: "optimistic",
        title: input.title,
        body: input.body ?? null,
        remind_at: input.remind_at,
        is_sent: false,
        task_id: input.task_id ?? null,
        note_id: input.note_id ?? null,
        created_at: new Date().toISOString(),
      };
      // Keep the cache sorted soonest-first to match the server order.
      const next = [...previous, optimistic].sort(
        (a, b) =>
          new Date(a.remind_at).getTime() - new Date(b.remind_at).getTime()
      );
      qc.setQueryData<Reminder[]>(REMINDERS_KEY, next);
      return { previous };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(REMINDERS_KEY, ctx.previous);
      toast.error(
        err instanceof Error ? err.message : "Failed to create reminder"
      );
    },
    onSuccess: () => toast.success("Reminder created"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: REMINDERS_KEY });
      invalidateDerivedCaches(qc, "reminders");
    },
  });
}

export function useUpdateReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateReminderInput) =>
      request<Reminder>("PATCH", input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: REMINDERS_KEY });
      const previous = qc.getQueryData<Reminder[]>(REMINDERS_KEY) ?? [];
      const next = previous
        .map((r) => (r.id === input.id ? { ...r, ...input } : r))
        .sort(
          (a, b) =>
            new Date(a.remind_at).getTime() - new Date(b.remind_at).getTime()
        );
      qc.setQueryData<Reminder[]>(REMINDERS_KEY, next);
      return { previous };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(REMINDERS_KEY, ctx.previous);
      toast.error(
        err instanceof Error ? err.message : "Failed to update reminder"
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: REMINDERS_KEY });
      invalidateDerivedCaches(qc, "reminders");
    },
  });
}

export function useDeleteReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<{ id: string }>("DELETE", { id }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: REMINDERS_KEY });
      const previous = qc.getQueryData<Reminder[]>(REMINDERS_KEY) ?? [];
      qc.setQueryData<Reminder[]>(
        REMINDERS_KEY,
        previous.filter((r) => r.id !== id)
      );
      return { previous };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(REMINDERS_KEY, ctx.previous);
      toast.error(
        err instanceof Error ? err.message : "Failed to delete reminder"
      );
    },
    onSuccess: () => toast.success("Reminder deleted"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: REMINDERS_KEY });
      invalidateDerivedCaches(qc, "reminders");
    },
  });
}
