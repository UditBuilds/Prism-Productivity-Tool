import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import toast from "react-hot-toast";

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

export function usePlansQuery() {
  return useQuery<Plan[]>({
    queryKey: PLANS_KEY,
    queryFn: () => request<Plan[]>("GET"),
  });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePlanInput) => request<Plan>("POST", input),
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
    onSettled: () => qc.invalidateQueries({ queryKey: PLANS_KEY }),
  });
}

export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePlanInput) => request<Plan>("PATCH", input),
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
    onSettled: () => qc.invalidateQueries({ queryKey: PLANS_KEY }),
  });
}

export function useDeletePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<{ id: string }>("DELETE", { id }),
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
