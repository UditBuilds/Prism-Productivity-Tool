import type { Note } from "@/types/database";
import type { NoteMode } from "@/components/notes/NoteModal";
import { NoteCard } from "./NoteCard";

/** Presentational grid of note cards (single column on mobile, 2 from md up). */
export function NoteList({
  notes,
  onOpen,
  onTagClick,
}: {
  notes: Note[];
  onOpen: (note: Note, mode: NoteMode) => void;
  onTagClick?: (tag: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-4">
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          onOpen={onOpen}
          onTagClick={onTagClick}
        />
      ))}
    </div>
  );
}
