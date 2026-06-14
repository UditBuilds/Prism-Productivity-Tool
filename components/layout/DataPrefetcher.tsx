"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { tasksQueryOptions } from "@/hooks/useTasks";
import { notesQueryOptions } from "@/hooks/useNotes";
import { plansQueryOptions } from "@/hooks/usePlans";
import { remindersQueryOptions } from "@/hooks/useReminders";
import { focusQueryOptions } from "@/hooks/useFocus";
import { moodQueryOptions } from "@/hooks/useMood";
import {
  srsCardsQueryOptions,
  srsAnalyticsQueryOptions,
} from "@/hooks/useSRS";

/**
 * Warms the React Query cache for every main-page dataset as soon as the
 * authenticated shell mounts, so navigating to a page hits a warm cache
 * instead of a cold fetch. Reuses each hook's exact query options (key +
 * queryFn + staleTime) — no duplicated fetch logic.
 *
 * Renders nothing. prefetchQuery fires in the background: it doesn't block
 * rendering, doesn't throw on failure, and never touches the UI. Calendar,
 * weekly review, and productivity are intentionally excluded (param-specific
 * or already lazy).
 */
export function DataPrefetcher() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Called individually (not over an array) so each set of options keeps its
    // own queryFn return type — a mixed array would collapse to a union that
    // prefetchQuery rejects.
    void queryClient.prefetchQuery(tasksQueryOptions);
    void queryClient.prefetchQuery(notesQueryOptions);
    void queryClient.prefetchQuery(plansQueryOptions);
    void queryClient.prefetchQuery(remindersQueryOptions);
    void queryClient.prefetchQuery(focusQueryOptions);
    void queryClient.prefetchQuery(moodQueryOptions);
    void queryClient.prefetchQuery(srsCardsQueryOptions);
    void queryClient.prefetchQuery(srsAnalyticsQueryOptions);
  }, [queryClient]);

  return null;
}
