import { useQuery } from "@tanstack/react-query";

import type { CalendarMonthData } from "@/app/api/calendar/route";
import { apiFetch } from "@/lib/api/client";

function fetchCalendarMonth(month: string): Promise<CalendarMonthData> {
  return apiFetch<CalendarMonthData>(`/api/calendar?month=${month}`);
}

/** Tasks + reminders grouped by IST date for one "YYYY-MM" month. */
export function useCalendarMonth(month: string) {
  return useQuery<CalendarMonthData>({
    queryKey: ["calendar", month],
    queryFn: () => fetchCalendarMonth(month),
    staleTime: 60_000, // tasks/reminders change more often than analytics
    gcTime: 120_000, // 2× staleTime — keep prior months around briefly
    // In-tab mutations invalidate ["calendar"] via lib/derived-caches, but a
    // calendar left open (background tab, resumed PWA) never sees mutations
    // made in another tab or on another device. Opt back into focus refetch
    // (globally off) so returning to the view revalidates once it's stale.
    refetchOnWindowFocus: true,
  });
}
