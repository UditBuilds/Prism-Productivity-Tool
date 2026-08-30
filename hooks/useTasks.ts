import {
  useMutation,
  useQuery,
  useQueryClient,
  type MutationMeta,
} from "@tanstack/react-query";
import toast from "react-hot-toast";

import { invalidateDerivedCaches } from "@/lib/derived-caches";
import { istWeekday, nextIstMatchingDayName } from "@/lib/date";
import { MAX_SPLIT_TASKS, type SplitTasksResult } from "@/lib/task-split";
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
// Task saves can create/clear the task's linked reminder server-side.
const REMINDERS_KEY = ["reminders"] as const;

/**
 * Optional task-linked reminder, carried inside the task mutation itself.
 *
 * `{ remind_at }` creates or updates the task's linked reminder, `null` clears
 * it, and OMITTING the key leaves reminders alone. The three states are
 * distinct: status-only PATCHes (swipe, status pill, dashboard row) omit it,
 * and must never be read as "clear".
 *
 * It rides on the task payload rather than a second mutation so an offline save
 * is one queue entry. A follow-up mutation fired from onSuccess cannot survive
 * dehydration — callbacks aren't serialised — so the reminder would be lost.
 */
export type TaskReminderInput = { remind_at: string } | null;

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string | null;
  plan_id?: string | null;
  reminder?: TaskReminderInput;
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
  reminder?: TaskReminderInput;
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

/**
 * `meta` is an opt-in for call sites whose result is rendered by a Server
 * Component (only CaptureField, on the dashboard). It is passed through to the
 * mutation rather than acted on here: the single handler in app/providers.tsx
 * reads it, so the behaviour is identical for an online success and for a
 * capture replayed from the offline queue. Every other call site of this hook
 * lives on a "use client" page and passes nothing, so nothing else is dragged
 * into a router refresh it has no use for.
 */
export function useCreateTask(meta?: MutationMeta) {
  const qc = useQueryClient();
  return useMutation({
    ...createTaskMutationOptions,
    meta,
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
      // A task save can now create/clear its linked reminder server-side, so
      // the reminders cache (and what it feeds) is no longer independent.
      qc.invalidateQueries({ queryKey: REMINDERS_KEY });
      invalidateDerivedCaches(qc, "reminders");
    },
  });
}

// ---------------------------------------------------------------------------
// AI capture split (POST /api/tasks/split)

export interface SplitTasksInput {
  /** The raw capture text, exactly as typed. */
  text: string;
}

async function requestSplit(input: SplitTasksInput): Promise<SplitTasksResult<Task>> {
  const res = await fetch("/api/tasks/split", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = (await res.json()) as ApiResponse<SplitTasksResult<Task>>;
  if (!res.ok || json.error || json.data === null) {
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  return json.data;
}

/**
 * A SECOND task-creating mutation key, which CaptureField was explicitly built
 * without — so it is worth saying why this one has to exist.
 *
 * Only mutations registered in lib/offline-mutations.ts are persisted at all;
 * anything else is DROPPED on reload rather than replayed. If the split path
 * dispatched over an unregistered key, a multi-item capture typed with no
 * signal would be silently discarded — strictly worse than today, where it
 * survives as one task. Registering it means the capture is queued once and the
 * split happens server-side on replay, which is exactly how the workout capture
 * already carries its AI parse through an offline gym session.
 */
export const splitTasksMutationOptions = {
  mutationKey: ["tasks", "split"] as const,
  mutationFn: (input: SplitTasksInput) => requestSplit(input),
};

/**
 * Send a capture to be read as several tasks. ONLY CaptureField calls this, and
 * only when lib/task-split.ts sees a reason to; everything else keeps
 * useCreateTask.
 *
 * The optimistic row is ONE task holding the literal text — the same floor the
 * route guarantees. It cannot know the real split until the server answers, and
 * claiming a number it might not get would be worse than briefly under-showing:
 * the onSettled invalidation replaces it with whatever was actually created.
 */
export function useSplitTasks(meta?: MutationMeta) {
  const qc = useQueryClient();
  return useMutation({
    ...splitTasksMutationOptions,
    meta,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY });
      const previous = qc.getQueryData<Task[]>(TASKS_KEY) ?? [];
      const now = new Date().toISOString();
      const optimistic: Task = {
        id: `optimistic-${crypto.randomUUID()}`,
        user_id: "optimistic",
        title: input.text,
        description: null,
        status: "todo",
        priority: "medium",
        due_date: null,
        plan_id: null,
        created_at: now,
        updated_at: now,
        completed_at: null,
      };
      qc.setQueryData<Task[]>(TASKS_KEY, [optimistic, ...previous]);
      return { previous };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(TASKS_KEY, ctx.previous);
      toast.error(err instanceof Error ? err.message : "Failed to create task");
    },
    onSuccess: (result) => {
      // Counted from the SERVER's rows, never from the request — the same rule
      // useLogWorkout follows, so the toast states what was actually stored.
      const n = result.tasks.length;
      const headline =
        n === 1 ? "Task created" : `${n} tasks created`;

      // The ` · ` suffix carries one secondary fact, matching the established
      // pattern in useSaveGeneratedCards / PDFUploadModal.
      //
      // "empty" gets NO apology: the call succeeded and the model judged the
      // capture to be one thing. Saying the AI failed there would be false, and
      // it is the same distinction EmptyGenerationError exists to draw.
      const suffix = result.truncated
        ? ` · kept the first ${MAX_SPLIT_TASKS}`
        : result.fallback && result.fallback !== "empty"
          ? " · couldn't split it just now"
          : "";

      toast.success(headline + suffix);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TASKS_KEY });
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
      // `reminder` is a request-only field, not a task column — keep it out of
      // the cached row (it would otherwise be persisted to IndexedDB too).
      const { reminder: _reminder, ...taskFields } = input;
      qc.setQueryData<Task[]>(
        TASKS_KEY,
        previous.map((t) =>
          t.id === input.id
            ? { ...t, ...taskFields, updated_at: new Date().toISOString() }
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
      // Completing a task clears its pending reminder, and an edit can add or
      // remove one — either way the reminders cache is now downstream of this.
      qc.invalidateQueries({ queryKey: REMINDERS_KEY });
      invalidateDerivedCaches(qc, "reminders");
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
      // The route also drops the task's pending reminders (PR #17).
      qc.invalidateQueries({ queryKey: REMINDERS_KEY });
      invalidateDerivedCaches(qc, "reminders");
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
