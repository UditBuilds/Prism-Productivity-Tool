import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { istDayContext } from "@/lib/date";
import { countSessionDays } from "@/lib/workouts";
import type { WorkoutSet } from "@/types/database";

const WORKOUTS_KEY = ["workouts"] as const;

export interface LogWorkoutInput {
  raw_input: string;
  /** Stamped client-side so an offline replay keeps the original log time. */
  performed_at?: string;
}

export interface UpdateWorkoutSetInput {
  id: string;
  exercise?: string | null;
  weight_kg?: number | null;
  reps?: number | null;
}

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

async function request<T>(method: string, body?: unknown): Promise<T> {
  const res = await fetch("/api/workouts", {
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

/**
 * Every set in the last 21 IST days. Today's list and the 21-day session count
 * both derive from this ONE cache via `select` — no second request.
 */
export const workoutsQueryOptions = {
  queryKey: WORKOUTS_KEY,
  queryFn: () => request<WorkoutSet[]>("GET"),
  staleTime: 3 * 60 * 1000,
  // Match the 24h persist maxAge so a tab with no mounted observer isn't GC'd
  // from memory before its offline snapshot expires.
  gcTime: 24 * 60 * 60 * 1000,
};

export function useWorkoutsQuery() {
  return useQuery(workoutsQueryOptions);
}

/** Today's (IST) sets only, oldest first. */
export function useTodaysSets() {
  return useQuery<WorkoutSet[], Error, WorkoutSet[]>({
    ...workoutsQueryOptions,
    select: (sets) => {
      const { startOfToday, endOfToday } = istDayContext();
      const from = Date.parse(startOfToday);
      const to = Date.parse(endOfToday);
      return sets.filter((s) => {
        const at = Date.parse(s.performed_at);
        return at >= from && at < to;
      });
    },
  });
}

/** Days with at least one set in the 21-day window — the feature's own usage. */
export function useSessionCount() {
  return useQuery<WorkoutSet[], Error, number>({
    ...workoutsQueryOptions,
    select: countSessionDays,
  });
}

// Keyed mutation options, also registered as queryClient defaults
// (lib/offline-mutations.ts) so a set logged in a gym with no signal survives a
// reload and replays — including the server-side parse — once back online.
export const logWorkoutMutationOptions = {
  mutationKey: ["workouts", "log"] as const,
  mutationFn: (input: LogWorkoutInput) =>
    request<WorkoutSet[]>("POST", input),
};

export const updateWorkoutSetMutationOptions = {
  mutationKey: ["workouts", "update"] as const,
  mutationFn: (input: UpdateWorkoutSetInput) =>
    request<WorkoutSet>("PATCH", input),
};

export const deleteWorkoutSetMutationOptions = {
  mutationKey: ["workouts", "delete"] as const,
  mutationFn: (id: string) => request<{ id: string }>("DELETE", { id }),
};

/**
 * Log-then-verify: one placeholder row appears instantly carrying the raw
 * text, and the refetch replaces it with the parsed sets. The optimistic row
 * deliberately has null parsed fields — the parse runs on the server, so
 * inventing an exercise name here would flash a guess that may not match.
 */
export function useLogWorkout() {
  const qc = useQueryClient();
  return useMutation({
    ...logWorkoutMutationOptions,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: WORKOUTS_KEY });
      const previous = qc.getQueryData<WorkoutSet[]>(WORKOUTS_KEY) ?? [];
      const now = new Date().toISOString();
      const optimistic: WorkoutSet = {
        id: `optimistic-${crypto.randomUUID()}`,
        user_id: "optimistic",
        capture_id: `optimistic-${crypto.randomUUID()}`,
        raw_input: input.raw_input,
        performed_at: input.performed_at ?? now,
        exercise: null,
        weight_kg: null,
        reps: null,
        set_index: null,
        created_at: now,
      };
      qc.setQueryData<WorkoutSet[]>(WORKOUTS_KEY, [...previous, optimistic]);
      return { previous };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(WORKOUTS_KEY, ctx.previous);
      toast.error(err instanceof Error ? err.message : "Failed to log");
    },
    onSuccess: (rows) => {
      // A single row with no exercise means the parse found nothing usable —
      // say so, because the card will show it as an uncorrected raw entry.
      if (rows.length === 1 && rows[0].exercise === null) {
        toast("Logged — couldn't read the sets, tap to fill them in");
      } else {
        toast.success(`Logged ${rows.length} set${rows.length === 1 ? "" : "s"}`);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: WORKOUTS_KEY });
    },
  });
}

/** Correct one parsed set. Touches that row only. */
export function useUpdateWorkoutSet() {
  const qc = useQueryClient();
  return useMutation({
    ...updateWorkoutSetMutationOptions,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: WORKOUTS_KEY });
      const previous = qc.getQueryData<WorkoutSet[]>(WORKOUTS_KEY) ?? [];
      qc.setQueryData<WorkoutSet[]>(
        WORKOUTS_KEY,
        previous.map((s) => (s.id === input.id ? { ...s, ...input } : s))
      );
      return { previous };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(WORKOUTS_KEY, ctx.previous);
      toast.error(err instanceof Error ? err.message : "Failed to update set");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: WORKOUTS_KEY });
    },
  });
}

export function useDeleteWorkoutSet() {
  const qc = useQueryClient();
  return useMutation({
    ...deleteWorkoutSetMutationOptions,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: WORKOUTS_KEY });
      const previous = qc.getQueryData<WorkoutSet[]>(WORKOUTS_KEY) ?? [];
      qc.setQueryData<WorkoutSet[]>(
        WORKOUTS_KEY,
        previous.filter((s) => s.id !== id)
      );
      return { previous };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(WORKOUTS_KEY, ctx.previous);
      toast.error(err instanceof Error ? err.message : "Failed to delete set");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: WORKOUTS_KEY });
    },
  });
}
