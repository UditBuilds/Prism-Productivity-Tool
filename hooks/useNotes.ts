import {
  useMutation,
  useQuery,
  useQueryClient,
  type MutationMeta,
} from "@tanstack/react-query";
import toast from "react-hot-toast";

import { markdownExcerpt } from "@/lib/markdown";
import type { Note } from "@/types/database";

const NOTES_KEY = ["notes"] as const;

export interface CreateNoteInput {
  title: string;
  content?: string;
  tags?: string[];
  kind?: "spark" | "revisit";
}

export interface UpdateNoteInput {
  id: string;
  title?: string;
  content?: string;
  tags?: string[];
  // Spark ↔ Revisit only. Recall is never a note, so it can't be a target or
  // source here (the DB CHECK constraint also rejects anything else).
  kind?: "spark" | "revisit";
}

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

async function request<T>(method: string, body?: unknown): Promise<T> {
  const res = await fetch("/api/notes", {
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
export const notesQueryOptions = {
  queryKey: NOTES_KEY,
  queryFn: () => request<Note[]>("GET"),
  staleTime: 10 * 60 * 1000,
  // Persisted cache: match the 24h persist maxAge so a tab with no mounted
  // observer isn't GC'd from memory before its offline snapshot expires.
  gcTime: 24 * 60 * 60 * 1000,
};

export function useNotesQuery() {
  return useQuery(notesQueryOptions);
}

// Keyed mutation options, also registered as queryClient defaults
// (lib/offline-mutations.ts) so mutations paused offline can resume after a
// page reload.
export const createNoteMutationOptions = {
  mutationKey: ["notes", "create"] as const,
  mutationFn: (input: CreateNoteInput) => request<Note>("POST", input),
};

export const updateNoteMutationOptions = {
  mutationKey: ["notes", "update"] as const,
  mutationFn: (input: UpdateNoteInput) => request<Note>("PATCH", input),
};

export const deleteNoteMutationOptions = {
  mutationKey: ["notes", "delete"] as const,
  mutationFn: (id: string) => request<{ id: string }>("DELETE", { id }),
  /**
   * ONE retry, against the global mutation default of 3.
   *
   * This is the only mutation in the app sitting behind a modal confirm that
   * BLOCKS on it. At the global 3 (TanStack's ~1s / 2s / 4s backoff) a failing
   * delete took four attempts and ~9s to reach a terminal state, and for that
   * whole window the dialog read "Deleting…" with BOTH buttons disabled — the
   * user could neither retry nor cancel. Measured, not estimated: attempts
   * landed at t+1.7s, t+2.7s, t+4.7s, t+8.7s, with the error toast at t+9.1s.
   * One retry is a single ~1s backoff, so the dialog reports failure and hands
   * the buttons back in about two seconds.
   *
   * NOT 0. The retryer only reaches the branch that PAUSES a mutation after a
   * failure it considers retryable; at retry 0 it rejects on the first failure
   * instead, so a delete tapped offline would settle as an error rather than
   * queue. Never paused means never persisted (shouldDehydrateMutation gates on
   * isPaused), so the delete would be silently lost. 1 is the smallest value
   * that keeps offline queuing intact.
   *
   * The REPLAY path is deliberately untouched and still uses the global 3:
   * lib/offline-mutations.ts registers only this object's mutationFn with
   * setMutationDefaults, not the whole object, so a resumed delete keeps the
   * three retries that exist to bridge the reconnect race (the online event
   * fires before the network interface is usable). No dialog is waiting on
   * that path, so its latency costs nothing.
   */
  retry: 1,
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
export function useCreateNote(meta?: MutationMeta) {
  const qc = useQueryClient();
  return useMutation({
    ...createNoteMutationOptions,
    meta,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: NOTES_KEY });
      const previous = qc.getQueryData<Note[]>(NOTES_KEY) ?? [];
      const now = new Date().toISOString();
      const optimistic: Note = {
        id: `optimistic-${crypto.randomUUID()}`,
        user_id: "optimistic",
        // Mirror the server: Revisit derives a title from the text; Spark
        // stays untitled (its card leads with the body).
        title:
          input.title ||
          (input.kind === "revisit"
            ? markdownExcerpt(input.content ?? "", 60)
            : ""),
        content: input.content ?? "",
        tags: input.tags ?? [],
        kind: input.kind ?? null,
        created_at: now,
        updated_at: now,
      };
      qc.setQueryData<Note[]>(NOTES_KEY, [optimistic, ...previous]);
      return { previous };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(NOTES_KEY, ctx.previous);
      toast.error(err instanceof Error ? err.message : "Failed to create note");
    },
    onSuccess: () => toast.success("Note created"),
    onSettled: () => qc.invalidateQueries({ queryKey: NOTES_KEY }),
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    ...updateNoteMutationOptions,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: NOTES_KEY });
      const previous = qc.getQueryData<Note[]>(NOTES_KEY) ?? [];
      qc.setQueryData<Note[]>(
        NOTES_KEY,
        previous.map((n) =>
          n.id === input.id
            ? { ...n, ...input, updated_at: new Date().toISOString() }
            : n
        )
      );
      return { previous };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(NOTES_KEY, ctx.previous);
      toast.error(err instanceof Error ? err.message : "Failed to update note");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: NOTES_KEY }),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    ...deleteNoteMutationOptions,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: NOTES_KEY });
      const previous = qc.getQueryData<Note[]>(NOTES_KEY) ?? [];
      qc.setQueryData<Note[]>(
        NOTES_KEY,
        previous.filter((n) => n.id !== id)
      );
      return { previous };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(NOTES_KEY, ctx.previous);
      toast.error(err instanceof Error ? err.message : "Failed to delete note");
    },
    onSuccess: () => toast.success("Note deleted"),
    onSettled: () => qc.invalidateQueries({ queryKey: NOTES_KEY }),
  });
}
