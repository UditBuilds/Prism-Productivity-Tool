"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Check, Loader2, Sparkles, X } from "lucide-react";

import { renderMarkdown } from "@/lib/markdown";
import { getTagColor } from "@/lib/tag-colors";
import { useCreateNote, useUpdateNote } from "@/hooks/useNotes";
import type { Note } from "@/types/database";
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

export type NoteMode = "read" | "edit";

/** Split a raw tags string ("a, b c") into a clean, de-duped list. */
function parseTagsInput(raw: string): string[] {
  const parts = raw
    .split(/[,\n]/)
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean);
  return Array.from(new Set(parts));
}

/**
 * Unified note modal: opens in READ mode (formatted, no inputs) or EDIT mode
 * (the markdown editor). Read→Edit via the header Edit button; Edit→Read on
 * save (so the user can keep reading). `note === null` means a new note, which
 * is edit-only. The built-in dialog close ✕ is suppressed ([&>button]:hidden)
 * so we can place our own ✕ on the left per the read-mode header spec.
 */
export function NoteModal({
  note,
  initialMode,
  open,
  onClose,
}: {
  note: Note | null;
  initialMode: NoteMode;
  open: boolean;
  onClose: () => void;
}) {
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();

  const [mode, setMode] = useState<NoteMode>(initialMode);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [titleError, setTitleError] = useState(false);
  const [reformatState, setReformatState] = useState<
    "idle" | "loading" | "success"
  >("idle");
  const [reformatError, setReformatError] = useState<string | null>(null);
  const qc = useQueryClient();

  // Hydrate whenever the modal opens. New notes can only be edited.
  useEffect(() => {
    if (!open) return;
    setTitleError(false);
    setReformatState("idle");
    setReformatError(null);
    setMode(note ? initialMode : "edit");
    if (note) {
      setTitle(note.title);
      setContent(note.content);
      setTagsInput(note.tags.join(", "));
    } else {
      setTitle("");
      setContent("");
      setTagsInput("");
    }
  }, [open, note, initialMode]);

  const tags = useMemo(() => parseTagsInput(tagsInput), [tagsInput]);
  const html = useMemo(() => renderMarkdown(content), [content]);

  /** Persist; returns false (and flags the error) if the title is empty. */
  function save(): boolean {
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError(true);
      return false;
    }
    const payload = { title: trimmed, content, tags };
    if (note) {
      updateNote.mutate({ id: note.id, ...payload });
    } else {
      createNote.mutate(payload);
    }
    return true;
  }

  // Done: save, then return to read for an existing note (keep reading);
  // a brand-new note has nothing to read back into, so close.
  function handleDone() {
    if (!save()) return;
    if (note) setMode("read");
    else onClose();
  }

  // AI reformat: sends the raw content to Groq, swaps in the structured
  // markdown on success, and refreshes the notes cache. The DB is only touched
  // when formatting succeeds (handled server-side).
  async function handleReformat() {
    if (!note || reformatState === "loading" || content.trim().length < 20) {
      return;
    }
    setReformatState("loading");
    setReformatError(null);
    try {
      const res = await fetch("/api/notes/reformat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId: note.id, content, title }),
      });
      const data = (await res.json()) as {
        data: { content: string } | null;
        error: string | null;
      };
      if (!res.ok || data.error || data.data === null) {
        throw new Error(data.error ?? `Reformat failed (${res.status})`);
      }
      setContent(data.data.content);
      qc.invalidateQueries({ queryKey: ["notes"] });
      setReformatState("success");
      setTimeout(() => setReformatState("idle"), 700);
    } catch (e) {
      setReformatState("idle");
      setReformatError(
        e instanceof Error ? e.message : "Couldn't reformat the note."
      );
      setTimeout(() => setReformatError(null), 3000);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl [&>button]:hidden">
        {mode === "read" ? (
          <>
            <DialogHeader className="flex-row items-center justify-between space-y-0">
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="-ml-1 rounded-md p-1 text-muted-foreground hover:bg-surface-raised hover:text-foreground active:scale-95"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="Reformat with AI"
                  title="Reformat with AI"
                  onClick={handleReformat}
                  disabled={
                    content.trim().length < 20 || reformatState === "loading"
                  }
                  className="flex items-center gap-1 text-accent transition-colors hover:text-accent-hover active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                >
                  {reformatState === "loading" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : reformatState === "success" ? (
                    <Check size={14} />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  <span className="text-xs">AI</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("edit")}
                  disabled={reformatState === "loading"}
                  className="text-sm font-medium text-accent hover:text-accent-hover disabled:pointer-events-none disabled:opacity-40"
                >
                  Edit
                </button>
              </div>
            </DialogHeader>

            <div>
              <DialogTitle className="mb-3 text-2xl font-bold text-foreground">
                {title.trim() || "Untitled note"}
              </DialogTitle>

              {reformatState === "loading" && (
                <p className="mb-3 text-xs text-muted-foreground">
                  Reformatting…
                </p>
              )}
              {reformatError && (
                <p className="mb-3 text-xs text-destructive">{reformatError}</p>
              )}

              {tags.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {tags.map((tag) => {
                    const color = getTagColor(tag);
                    return (
                      <span
                        key={tag}
                        className={`${color.bg} ${color.text} ${color.border} rounded-full border px-2 py-0.5 text-[11px] font-medium`}
                      >
                        #{tag}
                      </span>
                    );
                  })}
                </div>
              )}

              {content.trim() ? (
                <div
                  className="prose-preview pb-4 text-foreground"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              ) : (
                <p className="text-sm italic text-muted-foreground/70">
                  This note is empty.
                </p>
              )}

              {note?.updated_at && (
                <p className="mt-6 text-xs text-muted-foreground">
                  Updated{" "}
                  {formatDistanceToNow(new Date(note.updated_at), {
                    addSuffix: true,
                  })}
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="flex-row items-center justify-between space-y-0">
              <DialogTitle>{note ? "Edit note" : "New note"}</DialogTitle>
              <button
                type="button"
                onClick={handleDone}
                className="text-sm font-medium text-accent hover:text-accent-hover"
              >
                Done
              </button>
            </DialogHeader>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleDone();
              }}
              className="space-y-4"
            >
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
                        dangerouslySetInnerHTML={{ __html: html }}
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
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit">Save</Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
