"use client";

import { useMemo, useState } from "react";
import { Plus, Search, FileText, Upload, AlertCircle, X } from "lucide-react";

import { useNotesQuery } from "@/hooks/useNotes";
import { useUIStore } from "@/store/ui.store";
import type { Note } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NoteList } from "@/components/notes/NoteList";
import { NoteForm } from "@/components/notes/NoteForm";
import { GenerateCardsModal } from "@/components/srs/GenerateCardsModal";
import { PDFUploadModal } from "@/components/pdf/PDFUploadModal";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { EmptyState } from "@/components/shared/EmptyState";

/** Case-insensitive match across title, content, and tags. */
function matchesQuery(note: Note, q: string): boolean {
  const needle = q.toLowerCase();
  return (
    note.title.toLowerCase().includes(needle) ||
    note.content.toLowerCase().includes(needle) ||
    note.tags.some((t) => t.toLowerCase().includes(needle))
  );
}

export default function NotesPage() {
  const [query, setQuery] = useState("");
  const openCreateNote = useUIStore((s) => s.openCreateNote);
  const openPdfModal = useUIStore((s) => s.openPdfModal);
  const generateCardNoteId = useUIStore((s) => s.generateCardNoteId);
  const generateCardNoteTitle = useUIStore((s) => s.generateCardNoteTitle);
  const closeGenerateModal = useUIStore((s) => s.closeGenerateModal);
  const { data: notes, isLoading, isError, refetch } = useNotesQuery();

  const visible = useMemo(() => {
    const list = notes ?? [];
    const q = query.trim();
    return q ? list.filter((n) => matchesQuery(n, q)) : list;
  }, [notes, query]);

  const hasNotes = (notes?.length ?? 0) > 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Notes</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={openPdfModal}
            className="rounded-lg"
          >
            <Upload className="mr-1.5 h-4 w-4" />
            Upload PDF
          </Button>
          <Button onClick={openCreateNote} className="rounded-lg">
            <Plus className="mr-1.5 h-4 w-4" />
            New Note
          </Button>
        </div>
      </div>

      {hasNotes && (
        <div className="relative mt-5">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes by title, content, or tag…"
            className="rounded-lg pl-9 pr-9"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <div className="mt-5">
        {isLoading ? (
          <LoadingSkeleton count={4} />
        ) : isError ? (
          <EmptyState
            icon={AlertCircle}
            title="Couldn't load notes"
            description="Something went wrong fetching your notes."
            action={
              <Button variant="outline" onClick={() => refetch()}>
                Try again
              </Button>
            }
          />
        ) : !hasNotes ? (
          <EmptyState
            icon={FileText}
            title="No notes yet"
            description="Capture an idea — notes are the source AI will read to generate flashcards."
            action={
              <Button onClick={openCreateNote} className="rounded-lg">
                <Plus className="mr-1.5 h-4 w-4" />
                New Note
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No matches"
            description={`No notes match “${query.trim()}”.`}
            action={
              <Button variant="outline" onClick={() => setQuery("")}>
                Clear search
              </Button>
            }
          />
        ) : (
          <NoteList notes={visible} onTagClick={setQuery} />
        )}
      </div>

      <NoteForm />
      <GenerateCardsModal
        noteId={generateCardNoteId ?? ""}
        noteTitle={generateCardNoteTitle}
        open={generateCardNoteId !== null}
        onClose={closeGenerateModal}
      />
      <PDFUploadModal />
    </div>
  );
}
