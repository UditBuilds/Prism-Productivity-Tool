import { useQuery } from "@tanstack/react-query";

import type { ProductivityData } from "@/app/api/analytics/productivity/route";
import { apiFetch } from "@/lib/api/client";

function fetchProductivity(): Promise<ProductivityData> {
  return apiFetch<ProductivityData>("/api/analytics/productivity");
}

/** Focus/tasks/reviews trends for the last 30 IST days (5-min stale). */
export function useProductivityAnalytics() {
  return useQuery<ProductivityData>({
    queryKey: ["productivity-analytics"],
    queryFn: fetchProductivity,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
