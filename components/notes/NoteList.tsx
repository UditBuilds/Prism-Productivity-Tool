import type { Note } from "@/types/database";
import { NoteCard } from "./NoteCard";

/** Presentational grid of note cards (single column on mobile, 2 on wide). */
export function NoteList({
  notes,
  onTagClick,
}: {
  notes: Note[];
  onTagClick?: (tag: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {notes.map((note) => (
        <NoteCard key={note.id} note={note} onTagClick={onTagClick} />
      ))}
    </div>
  );
}
