import { useQuery } from "@tanstack/react-query";

import type { PushHealthData } from "@/app/api/push/health/route";
import { apiFetch } from "@/lib/api/client";

function fetchPushHealth(): Promise<PushHealthData> {
  return apiFetch<PushHealthData>("/api/push/health");
}

/**
 * Reminder push pipeline health (60s stale). Not registered in
 * lib/derived-caches — no user mutation changes it; it reflects the cron
 * worker, so it refreshes on its own cadence and on window focus.
 */
export function usePushHealth() {
  return useQuery<PushHealthData>({
    queryKey: ["push-health"],
    queryFn: fetchPushHealth,
    staleTime: 60_000,
    gcTime: 120_000,
    // The staleness threshold is 3 minutes; poll fast enough that a stalled
    // scheduler surfaces without a manual reload.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
