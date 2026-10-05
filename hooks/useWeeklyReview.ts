import { useQuery } from "@tanstack/react-query";

import type { WeeklyReviewData } from "@/app/api/review/weekly/route";
import { apiFetch } from "@/lib/api/client";

export type ReviewWeek = "current" | "previous";

function fetchWeeklyReview(week: ReviewWeek): Promise<WeeklyReviewData> {
  return apiFetch<WeeklyReviewData>(`/api/review/weekly?week=${week}`);
}

/** Weekly review payload for the selected IST Mon–Sun week (5-min stale). */
export function useWeeklyReview(week: ReviewWeek) {
  return useQuery<WeeklyReviewData>({
    queryKey: ["weekly-review", week],
    queryFn: () => fetchWeeklyReview(week),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
