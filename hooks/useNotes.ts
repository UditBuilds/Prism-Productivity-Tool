import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import toast from "react-hot-toast";

import type { Note } from "@/types/database";

const NOTES_KEY = ["notes"] as const;

export interface CreateNoteInput {
  title: string;
  content?: string;
  tags?: string[];
}

export interface UpdateNoteInput {
  id: string;
  title?: string;
  content?: string;
  tags?: string[];
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
};

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    ...createNoteMutationOptions,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: NOTES_KEY });
      const previous = qc.getQueryData<Note[]>(NOTES_KEY) ?? [];
      const now = new Date().toISOString();
      const optimistic: Note = {
        id: `optimistic-${crypto.randomUUID()}`,
        user_id: "optimistic",
        title: input.title,
        content: input.content ?? "",
        tags: input.tags ?? [],
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
