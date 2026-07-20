import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import toast from "react-hot-toast";

import { invalidateDerivedCaches } from "@/lib/derived-caches";
import type { Plan, PlanStatus } from "@/types/database";

const PLANS_KEY = ["plans"] as const;

export interface CreatePlanInput {
  title: string;
  description?: string | null;
  status?: PlanStatus;
  target_date?: string | null;
}

export interface UpdatePlanInput {
  id: string;
  title?: string;
  description?: string | null;
  status?: PlanStatus;
  target_date?: string | null;
}

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

async function request<T>(method: string, body?: unknown): Promise<T> {
  const res = await fetch("/api/plans", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!res.ok || json.error || json.data === null) {
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  return json.data;
}

// Exported so DataPrefetcher can warm this cache with the exact same queryFn.
export const plansQueryOptions = {
  queryKey: PLANS_KEY,
  queryFn: () => request<Plan[]>("GET"),
  staleTime: 15 * 60 * 1000,
  // Persisted cache: match the 24h persist maxAge so a tab with no mounted
  // observer isn't GC'd from memory before its offline snapshot expires.
  gcTime: 24 * 60 * 60 * 1000,
};

export function usePlansQuery() {
  return useQuery(plansQueryOptions);
}

// Keyed mutation options, also registered as queryClient defaults
// (lib/offline-mutations.ts) so mutations paused offline can resume after a
// page reload.
export const createPlanMutationOptions = {
  mutationKey: ["plans", "create"] as const,
  mutationFn: (input: CreatePlanInput) => request<Plan>("POST", input),
};

export const updatePlanMutationOptions = {
  mutationKey: ["plans", "update"] as const,
  mutationFn: (input: UpdatePlanInput) => request<Plan>("PATCH", input),
};

export const deletePlanMutationOptions = {
  mutationKey: ["plans", "delete"] as const,
  mutationFn: (id: string) => request<{ id: string }>("DELETE", { id }),
};

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    ...createPlanMutationOptions,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: PLANS_KEY });
      const previous = qc.getQueryData<Plan[]>(PLANS_KEY) ?? [];
      const now = new Date().toISOString();
      const optimistic: Plan = {
        id: `optimistic-${crypto.randomUUID()}`,
        user_id: "optimistic",
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? "active",
        target_date: input.target_date ?? null,
        created_at: now,
        updated_at: now,
      };
      qc.setQueryData<Plan[]>(PLANS_KEY, [optimistic, ...previous]);
      return { previous };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(PLANS_KEY, ctx.previous);
      toast.error(err instanceof Error ? err.message : "Failed to create plan");
    },
    onSuccess: () => toast.success("Plan created"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: PLANS_KEY });
      invalidateDerivedCaches(qc, "plans");
    },
  });
}

export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({
    ...updatePlanMutationOptions,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: PLANS_KEY });
      const previous = qc.getQueryData<Plan[]>(PLANS_KEY) ?? [];
      qc.setQueryData<Plan[]>(
        PLANS_KEY,
        previous.map((p) =>
          p.id === input.id
            ? { ...p, ...input, updated_at: new Date().toISOString() }
            : p
        )
      );
      return { previous };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(PLANS_KEY, ctx.previous);
      toast.error(err instanceof Error ? err.message : "Failed to update plan");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: PLANS_KEY });
      invalidateDerivedCaches(qc, "plans");
    },
  });
}

export function useDeletePlan() {
  const qc = useQueryClient();
  return useMutation({
    ...deletePlanMutationOptions,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: PLANS_KEY });
      const previous = qc.getQueryData<Plan[]>(PLANS_KEY) ?? [];
      qc.setQueryData<Plan[]>(
        PLANS_KEY,
        previous.filter((p) => p.id !== id)
      );
      return { previous };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(PLANS_KEY, ctx.previous);
      toast.error(err instanceof Error ? err.message : "Failed to delete plan");
    },
    onSuccess: () => toast.success("Plan deleted"),
    // Deleting a plan unlinks its tasks (plan_id → null), so refresh tasks too.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: PLANS_KEY });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}
