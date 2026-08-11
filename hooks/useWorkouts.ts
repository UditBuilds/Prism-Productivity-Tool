import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { istDayContext } from "@/lib/date";
import {
  countSessionDays,
  formatStructuredRawInput,
  type StructuredSetInput,
} from "@/lib/workouts";
import type { WorkoutSet } from "@/types/database";

const WORKOUTS_KEY = ["workouts"] as const;

/**
 * The two capture shapes POST /api/workouts accepts, as a union rather than
 * two optional fields so a call site has to mean one of them. `sets` is the
 * structured picker; `raw_input` is the free-text fallback.
 *
 * Both go through the SAME mutation below, and that is load-bearing rather
 * than tidy: only mutation keys registered in lib/offline-mutations.ts are
 * dehydrated to IndexedDB at all, so a second key for structured logging
 * would be dropped on reload instead of replayed.
 */
export type LogWorkoutInput =
  | {
      raw_input: string;
      sets?: undefined;
      /** Stamped client-side so an offline replay keeps the log time. */
      performed_at?: string;
    }
  | {
      sets: StructuredSetInput[];
      raw_input?: undefined;
      performed_at?: string;
    };

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
 * Log-then-verify. The optimistic rows differ by path, and the difference is
 * about what is actually known at this moment:
 *
 * - FREE TEXT: one placeholder row carrying the raw text and null parsed
 *   fields. The parse runs on the server, so inventing an exercise name here
 *   would flash a guess that may not match what comes back.
 * - STRUCTURED: one row per set with the real exercise, weight and reps.
 *   There is no guess — the server writes these exact values, so showing them
 *   immediately is accurate rather than optimistic. This is also what lets the
 *   ×N collapse appear the instant three identical sets are logged.
 */
export function useLogWorkout() {
  const qc = useQueryClient();
  return useMutation({
    ...logWorkoutMutationOptions,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: WORKOUTS_KEY });
      const previous = qc.getQueryData<WorkoutSet[]>(WORKOUTS_KEY) ?? [];
      const now = new Date().toISOString();
      const performedAt = input.performed_at ?? now;
      // One id per capture, mirroring the server's single crypto.randomUUID().
      const captureId = `optimistic-${crypto.randomUUID()}`;

      const base = {
        user_id: "optimistic",
        capture_id: captureId,
        performed_at: performedAt,
        created_at: now,
      };

      let optimistic: WorkoutSet[];
      if (input.sets) {
        // Bound to a const so the narrowing survives into the map callback —
        // TS widens a mutable parameter again inside a closure.
        const sets = input.sets;
        // Same helper the route uses, so the row does not visibly change
        // wording when the saved version replaces it.
        const rawInput = formatStructuredRawInput(sets);
        optimistic = sets.map((s, i) => ({
          ...base,
          id: `optimistic-${crypto.randomUUID()}`,
          raw_input: rawInput,
          exercise: s.exercise,
          weight_kg: s.weight_kg,
          reps: s.reps,
          set_index: i + 1,
        }));
      } else {
        optimistic = [
          {
            ...base,
            id: `optimistic-${crypto.randomUUID()}`,
            raw_input: input.raw_input,
            exercise: null,
            weight_kg: null,
            reps: null,
            set_index: null,
          },
        ];
      }

      qc.setQueryData<WorkoutSet[]>(WORKOUTS_KEY, previous.concat(optimistic));
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
