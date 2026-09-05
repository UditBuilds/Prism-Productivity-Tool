"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { renderMarkdown } from "@/lib/markdown";
import {
  revisitPreview,
  summaryParagraph,
} from "@/lib/notes/revisit-summary";
import { useDeleteNote } from "@/hooks/useNotes";
import type { Note } from "@/types/database";
import { ROW_META } from "@/components/dashboard/DashboardRow";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * One Revisit note on the dashboard, with a permanent delete behind a confirm.
 *
 * WHY THE DELETE IS SAFE, AND WHY THE DIALOG SAYS SO.
 *
 * Verified against the live database before this was built: both foreign keys
 * into `notes` — `srs_cards.note_id` and `reminders.note_id` — are
 * ON DELETE SET NULL. The only CASCADE in the graph fires when a CARD is
 * deleted, and `DELETE /api/notes` is a plain single-table delete that never
 * reaches cards. So deleting a note keeps every flashcard made from it, along
 * with its full SM-2 state and review history.
 *
 * The one real loss is attribution: `DeckStat.noteId` drives the
 * "From: <note title>" chip on DeckCard, and once `note_id` goes NULL there is
 * no way to re-link it through the UI. That is exactly why the dialog says the
 * cards are kept but will no longer show where they came from — a generic
 * "Are you sure?" would leave the user guessing about the thing that actually
 * changes.
 *
 * WHERE THE CONTROL SITS. Below the note's content, left-aligned on the page's
 * margin, on its own line. Not beside the title and not on the right edge: the
 * row body is the read target, so a destructive control inside it would sit
 * where a thumb lands both when reaching to read and when scrolling past. Put
 * under the content, a tap aimed at the note cannot reach it, and the left
 * margin is outside the arc a right thumb sweeps one-handed.
 *
 * WHAT IT LOOKS LIKE, AFTER DIRECTION A (#46). This component was written
 * against the pre-#46 row and has been rebased onto it. Three things changed
 * and all three are subtractions, which is the direction working as intended:
 *
 *   - The BookOpen glyph is gone. Every row in a section headed "Revisit" is a
 *     note, so it stated the one thing already true of all of them, and it cost
 *     the title its left alignment with every other title on the page.
 *   - The row's padding is px-4 py-4, matching the shipped Revisit row.
 *   - The Delete control is set in ROW_META — the same 12px mono-caps rank, at
 *     the same tracking-meta (0.06em), that AgendaTaskRow's state line uses.
 *     It was MonoLabel, which is now the COUNTER label rank (tracking-label,
 *     0.14em); a row-level control belongs with the row lines, not with the
 *     counter band. It carries no surface — no pill, no border, no fill. The
 *     only stroke on it is the focus ring, which is not decoration.
 *
 * NO NEW MUTATION KEY. `deleteNoteMutationOptions` already exists and is
 * already listed in RESUMABLE_MUTATION_KEYS with replay defaults registered in
 * lib/offline-mutations.ts, so a delete made offline is persisted and replayed
 * by machinery that predates this component.
 *
 * WHY THE BODY IS BOUNDED, AND WHY line-clamp WAS NOT THE FIX.
 *
 * This row used to render `renderMarkdown(note.content)` in full. That went
 * unnoticed while Revisit held short hand-written notes and became obvious the
 * moment 13 YouTube-import notes were switched to kind 'revisit' — the largest
 * is 114,787 characters, rendered complete, headings and all.
 *
 * The Notes tab does NOT share this bug, and it is worth being precise about
 * why: `NoteCard` renders `markdownExcerpt(content)`, which caps the string at
 * 180 characters BEFORE it becomes markup, into a `line-clamp-3` paragraph.
 * Two independent bounds. Adding `line-clamp` here would have fixed nothing —
 * `renderMarkdown` emits a multi-block tree (h2 / ul / p) and
 * `-webkit-line-clamp` only clamps a single block container.
 *
 * So the bound is on the CONTENT, decided by `revisitPreview`:
 *
 *   short note (<= 600 chars)  -> the raw markdown, exactly as before.
 *   long note with a summary   -> the cached AI key points, as ONE PARAGRAPH.
 *   long note, summary null    -> a truncated plain-text excerpt.
 *
 * The third branch is a stopgap, never a live AI call: this is inside a
 * Server-Component section, and a dashboard that waits on Groq to paint is a
 * worse failure than a slightly blunt preview. Summaries are written on save
 * (app/api/notes/route.ts) and were backfilled once for the existing rows.
 *
 * THE SUMMARY BRANCH IS NOW PROSE, NOT A LIST. It rendered the stored markdown,
 * which is a 2-4 item bullet list, under a "Key points" label — and with the
 * section down to ONE note that list was the tallest object on the dashboard:
 * every bullet wrapped to two or three lines and the list drew its own vertical
 * rhythm on top. `summaryParagraph` flattens the same characters into one
 * paragraph; nothing is regenerated and no model is called.
 *
 * THE OTHER TWO BRANCHES ARE UNTOUCHED. `fallback` was already a single clamped
 * paragraph. `raw` still renders a short note's own markdown, because a note at
 * or under 600 characters was never the height problem, and flattening a
 * hand-written note would throw away formatting the user typed on purpose. On
 * the live table that branch is unreachable anyway — the smallest Revisit note
 * is 1,886 characters.
 */
export function RevisitNoteRow({ note }: { note: Note }) {
  const router = useRouter();
  const deleteNote = useDeleteNote();
  const [open, setOpen] = useState(false);

  const preview = revisitPreview(note.content, note.summary);

  async function confirmDelete() {
    try {
      // AWAITED. mutateAsync rather than mutate: the dialog must not close and
      // the refresh must not fire until the write has actually landed.
      await deleteNote.mutateAsync(note.id);
      setOpen(false);
      // The Revisit section is rendered by a Server Component, so invalidating
      // the ["notes"] query cannot move it — only a router refresh re-runs the
      // server query that produced these rows.
      router.refresh();
    } catch (err) {
      // Not swallowed: useDeleteNote has already rolled the optimistic removal
      // back and shown the failure toast, so the job here is to keep the
      // dialog open for a retry and leave a breadcrumb. A permanent delete
      // that silently failed is worth one in the console.
      console.error("[revisit] delete failed", { noteId: note.id }, err);
    }
  }

  return (
    <li className="px-4 py-4">
      <p className="truncate text-sm font-semibold text-foreground">
        {note.title}
      </p>

      {/* ONE PARAGRAPH, AND NO "KEY POINTS" LABEL ABOVE IT.

          The label named a list; with the bullets flattened into prose there is
          no list for it to name, and it was a second line of chrome above a
          four-line body. `summaryParagraph` does the flattening — see that
          function for the punctuation rule, which is the only real decision in
          it.

          Plain text in a <p>, NOT renderMarkdown. The stored summary is a
          bullet list, so rendering it as markdown is what produced the <ul>
          this replaces; once flattened there is no markup left to render, and
          a <p> is both the honest element and the one that can be clamped. */}
      {preview.mode === "summary" && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {summaryParagraph(preview.markdown)}
        </p>
      )}

      {preview.mode === "raw" && (
        <div
          className="prose-preview mt-2 text-sm text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(preview.markdown) }}
        />
      )}

      {/* No summary yet. Plain text in a clamped paragraph — the same shape
          the Notes tab uses, so an unsummarized row can never be the tall one
          again even if the excerpt cap is later raised. */}
      {preview.mode === "fallback" && (
        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
          {preview.text}
        </p>
      )}

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group mt-2 inline-flex items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Delete note "${note.title}"`}
      >
        <span
          className={cn(
            ROW_META,
            "text-muted-foreground transition-colors group-hover:text-danger"
          )}
        >
          Delete
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            {/* Names the note. "Are you sure?" would make the user check which
                row they tapped before they could answer. */}
            <DialogTitle>Delete “{note.title}”?</DialogTitle>
            <DialogDescription>
              This permanently deletes the note and can&rsquo;t be undone. Any
              flashcards made from it are kept, along with their review
              history — but they will no longer show which note they came from.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={deleteNote.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteNote.isPending}
            >
              {deleteNote.isPending ? "Deleting…" : "Delete note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
