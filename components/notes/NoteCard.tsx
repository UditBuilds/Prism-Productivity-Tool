"use client";

import { formatDistanceToNow } from "date-fns";
import {
  BookOpen,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";

import { markdownExcerpt } from "@/lib/markdown";
import { getTagColor } from "@/lib/tag-colors";
import { useUIStore } from "@/store/ui.store";
import { useDeleteNote } from "@/hooks/useNotes";
import type { Note } from "@/types/database";
import type { NoteMode } from "@/components/notes/NoteModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function NoteCard({
  note,
  onOpen,
  onTagClick,
}: {
  note: Note;
  onOpen: (note: Note, mode: NoteMode) => void;
  onTagClick?: (tag: string) => void;
}) {
  const openGenerateModal = useUIStore((s) => s.openGenerateModal);
  const deleteNote = useDeleteNote();

  const preview = markdownExcerpt(note.content);
  const updated = formatDistanceToNow(new Date(note.updated_at), {
    addSuffix: true,
  });

  // The whole card opens the note in READ mode; the ··· menu and tag chips
  // stopPropagation so they keep working independently.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(note, "read")}
      onKeyDown={(e) => {
        if (
          e.target === e.currentTarget &&
          (e.key === "Enter" || e.key === " ")
        ) {
          e.preventDefault();
          onOpen(note, "read");
        }
      }}
      className="group flex cursor-pointer flex-col rounded-xl border border-border bg-surface p-4 text-left transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-lift active:scale-[0.99] active:opacity-90"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-sm font-medium text-foreground group-hover:text-accent">
          {note.title}
        </h3>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Note actions"
              onClick={(e) => e.stopPropagation()}
              className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground opacity-60 transition hover:bg-surface-raised hover:text-foreground group-hover:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-48"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => onOpen(note, "edit")}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => openGenerateModal(note.id, note.title)}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Generate Flashcards
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
        <p className="mt-2 line-clamp-3 text-sm text-muted-foreground first-line:font-medium first-line:text-muted-foreground/90">
          {preview}
        </p>
      ) : (
        <p className="mt-2 text-sm italic text-muted-foreground/70">
          Empty note
        </p>
      )}

      {note.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {note.tags.map((tag) => {
            const color = getTagColor(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTagClick?.(tag);
                }}
                className={`${color.bg} ${color.text} ${color.border} rounded-full border px-2 py-0.5 text-[11px] font-medium transition-shadow hover:opacity-80 hover:shadow-[0_0_8px_rgb(255_255_255/0.08)]`}
              >
                #{tag}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        {/* Graphite kind chip — legacy notes (kind null) show nothing. */}
        {note.kind && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-raised px-2 py-0.5 text-[11px] font-medium">
            {note.kind === "spark" ? (
              <Zap className="h-3 w-3" />
            ) : (
              <BookOpen className="h-3 w-3" />
            )}
            {note.kind === "spark" ? "Spark" : "Revisit"}
          </span>
        )}
        <span>Updated {updated}</span>
      </div>
    </div>
  );
}
