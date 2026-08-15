import { useQuery } from "@tanstack/react-query";

import type { WorkoutAnalysis } from "@/lib/workout-analysis";

export const WORKOUT_ANALYSIS_KEY = ["workout-analysis"] as const;

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

/**
 * Progressive overload + body-part balance over 180 IST days.
 *
 * A SEPARATE cache from ["workouts"], not a `select` off it: that cache holds
 * 21 days and this needs 180, so deriving one from the other would silently
 * analyse a twelfth of the history. Registered in lib/derived-caches.ts under
 * the `workout` source so logging a set marks it stale.
 */
export function useWorkoutAnalysis() {
  return useQuery<WorkoutAnalysis, Error>({
    queryKey: WORKOUT_ANALYSIS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/workouts/analysis");
      const json = (await res.json()) as ApiResponse<WorkoutAnalysis>;
      if (!res.ok || json.error || json.data === null) {
        throw new Error(json.error ?? `Request failed (${res.status})`);
      }
      return json.data;
    },
    // Matches the other analytics read models (productivity, weekly review).
    staleTime: 5 * 60 * 1000,
  });
}
