import { useQuery } from "@tanstack/react-query";

import type { PushHealthData } from "@/app/api/push/health/route";

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

async function fetchPushHealth(): Promise<PushHealthData> {
  const res = await fetch("/api/push/health");
  const json = (await res.json()) as ApiResponse<PushHealthData>;
  if (!res.ok || json.error || json.data === null) {
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  return json.data;
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
