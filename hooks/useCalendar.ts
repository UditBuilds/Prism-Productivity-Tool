import { useQuery } from "@tanstack/react-query";

import type { CalendarMonthData } from "@/app/api/calendar/route";

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

async function fetchCalendarMonth(month: string): Promise<CalendarMonthData> {
  const res = await fetch(`/api/calendar?month=${month}`);
  const json = (await res.json()) as ApiResponse<CalendarMonthData>;
  if (!res.ok || json.error || json.data === null) {
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  return json.data;
}

/** Tasks + reminders grouped by IST date for one "YYYY-MM" month. */
export function useCalendarMonth(month: string) {
  return useQuery<CalendarMonthData>({
    queryKey: ["calendar", month],
    queryFn: () => fetchCalendarMonth(month),
    staleTime: 60_000, // tasks/reminders change more often than analytics
  });
}
