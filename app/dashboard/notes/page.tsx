"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  Search,
  FileText,
  Upload,
  Play,
  AlertCircle,
  X,
} from "lucide-react";

import { useNotesQuery } from "@/hooks/useNotes";
import { useUIStore } from "@/store/ui.store";
import type { Note } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NoteList } from "@/components/notes/NoteList";
import { NoteModal, type NoteMode } from "@/components/notes/NoteModal";
import { GenerateCardsModal } from "@/components/srs/GenerateCardsModal";
import { PDFUploadModal } from "@/components/pdf/PDFUploadModal";
import { YouTubeImportModal } from "@/components/youtube/YouTubeImportModal";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { PullToRefresh } from "@/components/shared/PullToRefresh";
import { EmptyState } from "@/components/shared/EmptyState";
import { EmptyNotes } from "@/components/shared/EmptyStates";

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
  const [viewer, setViewer] = useState<{
    note: Note | null;
    mode: NoteMode;
  } | null>(null);
  const [youtubeOpen, setYoutubeOpen] = useState(false);
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
    <div className="animate-fade-up">
      <PullToRefresh onRefresh={() => refetch()}>
      <PageHeader
        title="Notes"
        subtitle="Your knowledge base"
        icon={FileText}
        actions={
          <>
            {/* PDF + YouTube import live behind one quiet trigger — three
                labeled buttons don't fit a 375px header. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Import"
                  className="rounded-lg"
                >
                  <Upload className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={openPdfModal}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload PDF
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => setYoutubeOpen(true)}
                >
                  <Play className="mr-2 h-4 w-4" />
                  YouTube
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              onClick={() => setViewer({ note: null, mode: "edit" })}
              className="rounded-lg"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              New Note
            </Button>
          </>
        }
      />

      {hasNotes && (
        <div className="group relative mt-5">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-accent" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
            className="rounded-lg pl-9 pr-9"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 animate-fade-in text-muted-foreground hover:text-foreground"
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
          <EmptyNotes
            action={
              <Button
                onClick={() => setViewer({ note: null, mode: "edit" })}
                className="rounded-lg"
              >
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
          <NoteList
            notes={visible}
            onOpen={(note, mode) => setViewer({ note, mode })}
            onTagClick={setQuery}
          />
        )}
      </div>

      <NoteModal
        note={viewer?.note ?? null}
        initialMode={viewer?.mode ?? "read"}
        open={viewer !== null}
        onClose={() => setViewer(null)}
      />
      <GenerateCardsModal
        noteId={generateCardNoteId ?? ""}
        noteTitle={generateCardNoteTitle}
        open={generateCardNoteId !== null}
        onClose={closeGenerateModal}
      />
      <PDFUploadModal />
      <YouTubeImportModal
        open={youtubeOpen}
        onClose={() => setYoutubeOpen(false)}
      />
      </PullToRefresh>
    </div>
  );
}
