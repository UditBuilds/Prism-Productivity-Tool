import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import toast from "react-hot-toast";

import { invalidateDerivedCaches } from "@/lib/derived-caches";
import { istWeekday, nextIstMatchingDayName } from "@/lib/date";
import type {
  RecurringTask,
  Task,
  TaskPriority,
  TaskStatus,
} from "@/types/database";

const TASKS_KEY = ["tasks"] as const;
// Active recurring templates (GET /api/tasks/recurring) — the persistent
// "this task repeats" surface on the tasks page.
const RECURRING_TEMPLATES_KEY = ["recurring-tasks"] as const;

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string | null;
  plan_id?: string | null;
  // Recurring create: the API builds a template and only spawns today's
  // instance when today (IST) is in days_of_week.
  repeat_daily?: boolean;
  days_of_week?: number[];
}

// POST response: a full Task row when today's instance was spawned, or just
// { id, instanceCreatedToday: false } when the first instance is deferred to
// the next scheduled day. Only `instanceCreatedToday` is read client-side.
type CreateTaskResult = Task & { instanceCreatedToday?: boolean };

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

// Exported so DataPrefetcher can warm this cache with the exact same queryFn.
export const tasksQueryOptions = {
  queryKey: TASKS_KEY,
  queryFn: () => request<Task[]>("GET"),
  staleTime: 3 * 60 * 1000,
  // Persisted cache: match the 24h persist maxAge so a tab with no mounted
  // observer isn't GC'd from memory before its offline snapshot expires.
  gcTime: 24 * 60 * 60 * 1000,
};

export function useTasksQuery() {
  return useQuery(tasksQueryOptions);
}

// Keyed mutation options, also registered as queryClient defaults
// (lib/offline-mutations.ts) so mutations paused offline can resume after a
// page reload — dehydrated mutations lose their functions and need a
// registered default mutationFn to run again.
export const createTaskMutationOptions = {
  mutationKey: ["tasks", "create"] as const,
  mutationFn: (input: CreateTaskInput) => request<CreateTaskResult>("POST", input),
};

export const updateTaskMutationOptions = {
  mutationKey: ["tasks", "update"] as const,
  mutationFn: (input: UpdateTaskInput) => request<Task>("PATCH", input),
};

export const deleteTaskMutationOptions = {
  mutationKey: ["tasks", "delete"] as const,
  mutationFn: (id: string) => request<{ id: string }>("DELETE", { id }),
};

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    ...createTaskMutationOptions,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY });
      const previous = qc.getQueryData<Task[]>(TASKS_KEY) ?? [];
      // A recurring create on a non-scheduled IST day makes NO task row (only
      // the template) — an optimistic row would appear, then vanish on refetch
      // and read as a failed create. Skip it; the deferred toast + recurring
      // strip carry the feedback instead.
      const spawnsToday =
        input.repeat_daily !== true ||
        (input.days_of_week ?? []).includes(istWeekday());
      if (spawnsToday) {
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
          completed_at: (input.status ?? "todo") === "done" ? now : null,
        };
        qc.setQueryData<Task[]>(TASKS_KEY, [optimistic, ...previous]);
      }
      return { previous };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(TASKS_KEY, ctx.previous);
      toast.error(err instanceof Error ? err.message : "Failed to create task");
    },
    onSuccess: (data, input) => {
      // Deferred first instance: say when it lands instead of the generic
      // "Task created" (which would promise a task that isn't in the list).
      if (data.instanceCreatedToday === false) {
        toast.success(
          `Recurring task created — first task on ${nextIstMatchingDayName(
            input.days_of_week ?? []
          )}`
        );
      } else {
        toast.success("Task created");
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TASKS_KEY });
      qc.invalidateQueries({ queryKey: RECURRING_TEMPLATES_KEY });
      invalidateDerivedCaches(qc, "tasks");
    },
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    ...updateTaskMutationOptions,
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
      // "Stop repeating" rides on PATCH — the template list may have changed.
      qc.invalidateQueries({ queryKey: RECURRING_TEMPLATES_KEY });
      invalidateDerivedCaches(qc, "tasks");
    },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    ...deleteTaskMutationOptions,
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
      // Deleting a recurring instance deactivates its template server-side.
      qc.invalidateQueries({ queryKey: RECURRING_TEMPLATES_KEY });
      invalidateDerivedCaches(qc, "tasks");
    },
  });
}

// ---------------------------------------------------------------------------
// Recurring templates (GET/PATCH /api/tasks/recurring)

async function requestRecurring<T>(method: string, body?: unknown): Promise<T> {
  const res = await fetch("/api/tasks/recurring", {
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

/** The user's ACTIVE recurring templates — drives the tasks-page strip. */
export function useRecurringTemplatesQuery() {
  return useQuery({
    queryKey: RECURRING_TEMPLATES_KEY,
    queryFn: () => requestRecurring<RecurringTask[]>("GET"),
    staleTime: 3 * 60 * 1000,
  });
}

export const stopRecurringTemplateMutationOptions = {
  mutationKey: ["recurring-tasks", "stop"] as const,
  mutationFn: (id: string) =>
    requestRecurring<{ id: string }>("PATCH", { id }),
};

/** Deactivate a template by id (no task instance required, unlike the
 *  TaskCard "Stop repeating" action which goes through an instance). */
export function useStopRecurringTemplate() {
  const qc = useQueryClient();
  return useMutation({
    ...stopRecurringTemplateMutationOptions,
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Failed to stop recurring task"
      ),
    onSuccess: () => toast.success("Won't repeat anymore"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: RECURRING_TEMPLATES_KEY });
    },
  });
}
