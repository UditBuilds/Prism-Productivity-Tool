import { useQuery } from "@tanstack/react-query";

import type { ProductivityData } from "@/app/api/analytics/productivity/route";

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

async function fetchProductivity(): Promise<ProductivityData> {
  const res = await fetch("/api/analytics/productivity");
  const json = (await res.json()) as ApiResponse<ProductivityData>;
  if (!res.ok || json.error || json.data === null) {
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  return json.data;
}

/** Focus/tasks/reviews trends for the last 30 IST days (5-min stale). */
export function useProductivityAnalytics() {
  return useQuery<ProductivityData>({
    queryKey: ["productivity-analytics"],
    queryFn: fetchProductivity,
    staleTime: 5 * 60 * 1000,
  });
}
