import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api/client";
import type { WorkoutAnalysis } from "@/lib/workout-analysis";

export const WORKOUT_ANALYSIS_KEY = ["workout-analysis"] as const;

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
    queryFn: () => apiFetch<WorkoutAnalysis>("/api/workouts/analysis"),
    // Matches the other analytics read models (productivity, weekly review).
    staleTime: 5 * 60 * 1000,
  });
}
