import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import toast from "react-hot-toast";

import { invalidateDerivedCaches } from "@/lib/derived-caches";
import type { Task, TaskPriority, TaskStatus } from "@/types/database";

const TASKS_KEY = ["tasks"] as const;

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string | null;
  plan_id?: string | null;
}

export interface UpdateTaskInput {
  id: string;
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string | null;
  plan_id?: string | null;
}

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

async function request<T>(
  method: string,
  body?: unknown
): Promise<T> {
  const res = await fetch("/api/tasks", {
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

export function useTasksQuery() {
  return useQuery<Task[]>({
    queryKey: TASKS_KEY,
    queryFn: () => request<Task[]>("GET"),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) => request<Task>("POST", input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY });
      const previous = qc.getQueryData<Task[]>(TASKS_KEY) ?? [];
      const now = new Date().toISOString();
      const optimistic: Task = {
        id: `optimistic-${crypto.randomUUID()}`,
        user_id: "optimistic",
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? "todo",
        priority: input.priority ?? "medium",
        due_date: input.due_date ?? null,
        plan_id: input.plan_id ?? null,
        created_at: now,
        updated_at: now,
      };
      qc.setQueryData<Task[]>(TASKS_KEY, [optimistic, ...previous]);
      return { previous };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(TASKS_KEY, ctx.previous);
      toast.error(err instanceof Error ? err.message : "Failed to create task");
    },
    onSuccess: () => toast.success("Task created"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TASKS_KEY });
      invalidateDerivedCaches(qc, "tasks");
    },
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTaskInput) => request<Task>("PATCH", input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY });
      const previous = qc.getQueryData<Task[]>(TASKS_KEY) ?? [];
      qc.setQueryData<Task[]>(
        TASKS_KEY,
        previous.map((t) =>
          t.id === input.id
            ? { ...t, ...input, updated_at: new Date().toISOString() }
            : t
        )
      );
      return { previous };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(TASKS_KEY, ctx.previous);
      toast.error(err instanceof Error ? err.message : "Failed to update task");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TASKS_KEY });
      invalidateDerivedCaches(qc, "tasks");
    },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<{ id: string }>("DELETE", { id }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY });
      const previous = qc.getQueryData<Task[]>(TASKS_KEY) ?? [];
      qc.setQueryData<Task[]>(
        TASKS_KEY,
        previous.filter((t) => t.id !== id)
      );
      return { previous };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(TASKS_KEY, ctx.previous);
      toast.error(err instanceof Error ? err.message : "Failed to delete task");
    },
    onSuccess: () => toast.success("Task deleted"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TASKS_KEY });
      invalidateDerivedCaches(qc, "tasks");
    },
  });
}
