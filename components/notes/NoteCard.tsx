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

import { cn } from "@/lib/utils";
import { markdownExcerpt } from "@/lib/markdown";
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

  const title = note.title.trim();
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
      className="group flex cursor-pointer flex-col rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-accent/25 active:scale-[0.99] active:opacity-90"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* Kind eyebrow — mono caps, graphite. Legacy notes (kind null)
              simply start with the title; no indicator, on purpose. */}
          {note.kind && (
            <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {note.kind === "spark" ? (
                <Zap className="h-3 w-3" aria-hidden />
              ) : (
                <BookOpen className="h-3 w-3" aria-hidden />
              )}
              {note.kind}
            </p>
          )}
          {title && (
            <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-foreground group-hover:text-accent">
              {title}
            </h3>
          )}
        </div>

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
        // Untitled sparks lead with their body — the text IS the note, so it
        // takes the foreground slot a title would otherwise occupy.
        <p
          className={cn(
            "line-clamp-3 text-[13px] leading-relaxed text-muted-foreground",
            title ? "mt-2" : "mt-0.5 line-clamp-4 text-sm text-foreground/90"
          )}
        >
          {preview}
        </p>
      ) : (
        <p className="mt-2 text-[13px] italic text-muted-foreground/70">
          Empty note
        </p>
      )}

      {note.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {note.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTagClick?.(tag);
              }}
              className="rounded-full border border-border bg-surface-raised px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      <p className="mt-3.5 text-[11px] text-muted-foreground/80">
        Updated {updated}
      </p>
    </div>
  );
}
