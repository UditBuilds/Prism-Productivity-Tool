import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api/client";
import { istDateString } from "@/lib/date";
import { addCivilDays } from "@/lib/daily-plan/compose";
import { invalidateDerivedCaches } from "@/lib/derived-caches";
import { REFRESH_SERVER_DATA } from "@/lib/rsc-refresh";
import { useUpdateTask } from "@/hooks/useTasks";
import type {
  DailyPlanEdit,
  DailyPlanEditResponse,
  DailyPlanView,
} from "@/lib/daily-plan/view";

/**
 * NOT "plans". The older Plans feature already owns ["plans"] — a persisted,
 * offline-resumable key that is also an invalidateDerivedCaches source — so
 * this feature keeps to ["daily-plan", <IST date>] everywhere.
 *
 * The IST date is part of the key so a snapshot restored from IndexedDB can
 * never show yesterday's plan as today's: after midnight the key changes and
 * yesterday's entry simply isn't read.
 */
export const DAILY_PLAN_KEY = "daily-plan";

export function dailyPlanQueryOptions(planDate: string) {
  return {
    queryKey: [DAILY_PLAN_KEY, planDate] as const,
    // POST, not GET — see app/api/daily-plan/route.ts (the service worker
    // caches GET /api/* for 24h).
    queryFn: () => apiFetch<DailyPlanView>("/api/daily-plan", "POST"),
    staleTime: 60_000,
    // Persisted (lib/query-persister.ts): match the 24h persist maxAge so the
    // offline snapshot isn't GC'd from memory first.
    gcTime: 24 * 60 * 60 * 1000,
  };
}

export function useDailyPlan() {
  return useQuery(dailyPlanQueryOptions(istDateString()));
}

/**
 * ONE key for every plan edit (accept, move, move_all, drop), registered in
 * lib/offline-mutations.ts so an edit made with no signal survives a reload
 * and replays on reconnect. Everything the replay needs is in the variables —
 * the server derives "tomorrow" from the plan's own date — because call-site
 * callbacks are not dehydrated.
 */
export const updateDailyPlanMutationOptions = {
  mutationKey: [DAILY_PLAN_KEY, "update"] as const,
  mutationFn: (input: DailyPlanEdit) =>
    apiFetch<DailyPlanEditResponse>("/api/daily-plan", "PATCH", input),
};

/** The optimistic version of what PATCH /api/daily-plan does to the view. */
export function applyPlanEdit(
  view: DailyPlanView | undefined,
  edit: DailyPlanEdit,
  nowIso: string
): DailyPlanView | undefined {
  if (!view?.plan) return view;
  const plan = view.plan;
  if (edit.action === "accept") {
    if (edit.plan_id !== plan.id || plan.accepted_at) return view;
    return { ...view, plan: { ...plan, accepted_at: nowIso } };
  }
  const targets = new Set(edit.action === "move_all" ? edit.item_ids : [edit.item_id]);
  return {
    ...view,
    items: view.items.map((item) => {
      if (!targets.has(item.id) || item.status !== "planned") return item;
      if (edit.action === "move" || edit.action === "move_all") {
        return { ...item, status: "moved", moved_to: addCivilDays(plan.plan_date, 1) };
      }
      return { ...item, status: item.kind === "anchor" ? "skipped" : "dropped" };
    }),
  };
}

/** The plan cache with one task's rows read as done. */
export function markPlanTaskDone(
  view: DailyPlanView | undefined,
  taskId: string
): DailyPlanView | undefined {
  if (!view?.plan) return view;
  return {
    ...view,
    items: view.items.map((item) =>
      item.task_id === taskId ? { ...item, task_done: true } : item
    ),
  };
}

export function useUpdateDailyPlan() {
  const qc = useQueryClient();
  return useMutation({
    ...updateDailyPlanMutationOptions,
    // A move changes a task's due date, which the server-rendered agenda and
    // the Overdue counter read. app/providers.tsx turns this into one
    // coalesced router.refresh() on success, online or replayed.
    meta: { refreshServerData: true },
    onMutate: async (edit) => {
      await qc.cancelQueries({ queryKey: [DAILY_PLAN_KEY] });
      const previous = qc.getQueriesData<DailyPlanView>({ queryKey: [DAILY_PLAN_KEY] });
      const nowIso = new Date().toISOString();
      qc.setQueriesData<DailyPlanView>({ queryKey: [DAILY_PLAN_KEY] }, (view) =>
        applyPlanEdit(view, edit, nowIso)
      );
      return { previous };
    },
    onError: (_err, _edit, ctx) => {
      for (const [key, data] of (ctx?.previous ?? []) as [QueryKey, DailyPlanView | undefined][]) {
        qc.setQueryData(key, data);
      }
      toast.error("Couldn't update today's plan");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [DAILY_PLAN_KEY] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      invalidateDerivedCaches(qc, "tasks");
    },
  });
}

/**
 * Done on a plan row. NOT a plan edit: completing a task is the existing
 * ["tasks", "update"] mutation, already offline-resumable, so the server's
 * completed_at stamping and every task cache behave exactly as elsewhere.
 *
 * The plan cache is marked done up front because useUpdateTask only updates
 * ["tasks"] optimistically; without this the row would read unfinished until
 * a refetch, i.e. for as long as the phone is offline. The persisted snapshot
 * keeps that across a reload. If the write fails, useUpdateTask's onSettled
 * invalidates ["daily-plan"] (a derived cache of "tasks") and the refetch
 * restores the truth.
 */
export function useCompletePlanTask() {
  const qc = useQueryClient();
  const updateTask = useUpdateTask(REFRESH_SERVER_DATA);
  return (taskId: string) => {
    void qc.cancelQueries({ queryKey: [DAILY_PLAN_KEY] });
    qc.setQueriesData<DailyPlanView>({ queryKey: [DAILY_PLAN_KEY] }, (view) =>
      markPlanTaskDone(view, taskId)
    );
    // Only status — the API route stamps completed_at server-side.
    updateTask.mutate({ id: taskId, status: "done" });
  };
}
