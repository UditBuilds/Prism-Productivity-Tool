import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { istDateString } from "@/lib/date";
import { invalidateDerivedCaches } from "@/lib/derived-caches";
import type { WorkoutSessionSummary } from "@/app/api/workouts/sessions/route";
import type { WorkoutSessionStatus } from "@/types/database";

const SESSIONS_KEY = ["workout-sessions"] as const;

export type { WorkoutSessionSummary };

export interface UpdateSessionInput {
  id: string;
  status?: WorkoutSessionStatus;
  notes?: string | null;
}

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

async function request<T>(method: string, body?: unknown): Promise<T> {
  const res = await fetch("/api/workouts/sessions", {
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
 * Every session in the last 180 IST days.
 *
 * ITS OWN KEY, REPLACING NEITHER EXISTING ONE. ["workouts"] is 60 days of raw
 * SET rows feeding the logging screen; ["workout-analysis"] is a 180-day
 * derived read model of progression and balance. A session is a third thing —
 * a durable record of a training day — with its own lifecycle (it can be
 * finished, it can carry notes) that neither of those caches can express.
 *
 * The Workout page's "is there a session today" derives from this ONE cache
 * via `select` rather than asking for a single row, the same trick
 * useTodaysSets and useSessionCount use off ["workouts"]. Session rows are
 * one per training DAY, so six months of real training is single digits.
 */
export const workoutSessionsQueryOptions = {
  queryKey: SESSIONS_KEY,
  queryFn: () => request<WorkoutSessionSummary[]>("GET"),
  staleTime: 5 * 60 * 1000,
  // Match the 24h persist maxAge so a tab with no mounted observer isn't GC'd
  // from memory before its offline snapshot expires.
  gcTime: 24 * 60 * 60 * 1000,
};

export function useWorkoutSessionsQuery() {
  return useQuery(workoutSessionsQueryOptions);
}

/**
 * Today's (IST) session, or null.
 *
 * MATCHED ON THE DAY, NOT ON status === "active". A session from an earlier
 * day that was never finished stays `active` on purpose — the app has no
 * evidence a day was abandoned rather than merely not closed — so "the first
 * active session" would hand the Workout page an August session to finish in
 * September.
 */
export function useTodaysSession() {
  return useQuery<
    WorkoutSessionSummary[],
    Error,
    WorkoutSessionSummary | null
  >({
    ...workoutSessionsQueryOptions,
    select: (sessions) => {
      const today = istDateString();
      return sessions.find((s) => s.performed_on === today) ?? null;
    },
  });
}

// Keyed mutation options, also registered as queryClient defaults
// (lib/offline-mutations.ts) so finishing a workout in a gym with no signal
// survives a reload and replays.
export const updateWorkoutSessionMutationOptions = {
  mutationKey: ["workout-sessions", "update"] as const,
  mutationFn: (input: UpdateSessionInput) =>
    request<{ id: string }>("PATCH", input),
};

/**
 * Finish a session, add notes, or reopen one.
 *
 * The optimistic update writes `ended_at` locally so the review can state a
 * duration immediately; the server owns the real value and the refetch in
 * onSettled replaces it. They can differ by the round trip, which is not a
 * number anyone reads to the second.
 */
export function useUpdateWorkoutSession() {
  const qc = useQueryClient();
  return useMutation({
    ...updateWorkoutSessionMutationOptions,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: SESSIONS_KEY });
      const previous =
        qc.getQueryData<WorkoutSessionSummary[]>(SESSIONS_KEY) ?? [];
      qc.setQueryData<WorkoutSessionSummary[]>(
        SESSIONS_KEY,
        previous.map((s) =>
          s.id === input.id
            ? {
                ...s,
                status: input.status ?? s.status,
                ended_at:
                  input.status === undefined
                    ? s.ended_at
                    : input.status === "completed"
                      ? new Date().toISOString()
                      : null,
                notes: input.notes === undefined ? s.notes : input.notes,
              }
            : s
        )
      );
      return { previous };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(SESSIONS_KEY, ctx.previous);
      toast.error(
        err instanceof Error ? err.message : "Couldn't update the workout"
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: SESSIONS_KEY });
      invalidateDerivedCaches(qc, "workout");
    },
  });
}
