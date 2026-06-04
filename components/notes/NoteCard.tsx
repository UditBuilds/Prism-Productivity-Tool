"use client";

import { formatDistanceToNow } from "date-fns";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { markdownExcerpt } from "@/lib/markdown";
import { useUIStore } from "@/store/ui.store";
import { useDeleteNote } from "@/hooks/useNotes";
import type { Note } from "@/types/database";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function NoteCard({
  note,
  onTagClick,
}: {
  note: Note;
  onTagClick?: (tag: string) => void;
}) {
  const openEditNote = useUIStore((s) => s.openEditNote);
  const deleteNote = useDeleteNote();

  const preview = markdownExcerpt(note.content);
  const updated = formatDistanceToNow(new Date(note.updated_at), {
    addSuffix: true,
  });

  return (
    <div className="group flex flex-col rounded-xl border border-border bg-surface p-4 transition-colors hover:border-muted-foreground/40">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => openEditNote(note)}
          className="line-clamp-2 text-left text-sm font-medium text-foreground hover:text-accent"
        >
          {note.title}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Note actions"
              className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground opacity-60 transition hover:bg-surface-raised hover:text-foreground group-hover:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => openEditNote(note)}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer text-danger focus:text-danger"
              onClick={() => deleteNote.mutate(note.id)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {preview ? (
        <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
          {preview}
        </p>
      ) : (
        <p className="mt-2 text-sm italic text-muted-foreground/70">
          Empty note
        </p>
      )}

      {note.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {note.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onTagClick?.(tag)}
              className="rounded-md bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent transition hover:bg-accent/25"
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">Updated {updated}</p>
    </div>
  );
}
