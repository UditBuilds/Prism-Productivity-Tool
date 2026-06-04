"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import { renderMarkdown } from "@/lib/markdown";
import { useUIStore } from "@/store/ui.store";
import { useCreateNote, useUpdateNote } from "@/hooks/useNotes";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Split a raw tags string ("a, b c") into a clean, de-duped list. */
function parseTagsInput(raw: string): string[] {
  const parts = raw
    .split(/[,\n]/)
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean);
  return Array.from(new Set(parts));
}

export function NoteForm() {
  const { noteDialogOpen, editingNote, closeNoteDialog } = useUIStore();
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [titleError, setTitleError] = useState(false);

  // Hydrate the form whenever the dialog opens (create vs edit).
  useEffect(() => {
    if (!noteDialogOpen) return;
    setTitleError(false);
    if (editingNote) {
      setTitle(editingNote.title);
      setContent(editingNote.content);
      setTagsInput(editingNote.tags.join(", "));
    } else {
      setTitle("");
      setContent("");
      setTagsInput("");
    }
  }, [noteDialogOpen, editingNote]);

  const tags = useMemo(() => parseTagsInput(tagsInput), [tagsInput]);
  const previewHtml = useMemo(() => renderMarkdown(content), [content]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError(true);
      return;
    }

    const payload = { title: trimmed, content, tags };

    if (editingNote) {
      updateNote.mutate({ id: editingNote.id, ...payload });
    } else {
      createNote.mutate(payload);
    }
    closeNoteDialog();
  }

  return (
    <Dialog
      open={noteDialogOpen}
      onOpenChange={(open) => !open && closeNoteDialog()}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editingNote ? "Edit note" : "New note"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="note-title">Title</Label>
            <Input
              id="note-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError(false);
              }}
              placeholder="Untitled note"
              autoFocus
              className="rounded-lg"
            />
            {titleError && (
              <p className="text-xs text-danger">Title is required.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Content</Label>
            <Tabs defaultValue="write">
              <TabsList className="grid w-44 grid-cols-2">
                <TabsTrigger value="write">Write</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
              <TabsContent value="write">
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Write in markdown… # headings, **bold**, - lists, `code`"
                  rows={12}
                  className="rounded-lg font-mono text-sm"
                />
              </TabsContent>
              <TabsContent value="preview">
                {content.trim() ? (
                  <div
                    className="prose-preview min-h-[16rem] space-y-2 rounded-lg border border-border bg-surface p-4 text-sm text-foreground"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                ) : (
                  <div className="flex min-h-[16rem] items-center justify-center rounded-lg border border-dashed border-border bg-surface text-sm text-muted-foreground">
                    Nothing to preview yet.
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-2">
            <Label htmlFor="note-tags">Tags</Label>
            <Input
              id="note-tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="Comma-separated, e.g. biology, exam, chapter-3"
              className="rounded-lg"
            />
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent"
                  >
                    #{tag}
                    <button
                      type="button"
                      aria-label={`Remove ${tag}`}
                      onClick={() =>
                        setTagsInput(tags.filter((t) => t !== tag).join(", "))
                      }
                      className="text-accent/70 hover:text-accent"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="ghost" onClick={closeNoteDialog}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
