import { useQuery } from "@tanstack/react-query";

import type { WeeklyReviewData } from "@/app/api/review/weekly/route";

export type ReviewWeek = "current" | "previous";

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

async function fetchWeeklyReview(week: ReviewWeek): Promise<WeeklyReviewData> {
  const res = await fetch(`/api/review/weekly?week=${week}`);
  const json = (await res.json()) as ApiResponse<WeeklyReviewData>;
  if (!res.ok || json.error || json.data === null) {
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  return json.data;
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
