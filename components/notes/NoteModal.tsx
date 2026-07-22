"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  Loader2,
  Sparkles,
  X,
  Zap,
} from "lucide-react";

import { markdownExcerpt, renderMarkdown } from "@/lib/markdown";
import { useCreateNote, useUpdateNote } from "@/hooks/useNotes";
import { useCreateCard } from "@/hooks/useSRS";
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

/** What a new capture is FOR — chosen once at save time. */
type CaptureKind = "spark" | "revisit" | "recall";

const KIND_OPTIONS: {
  value: CaptureKind;
  label: string;
  icon: typeof Zap;
  hint: string;
}[] = [
  {
    value: "spark",
    label: "Spark",
    icon: Zap,
    hint: "Quick idea — stays in Notes.",
  },
  {
    value: "revisit",
    label: "Revisit",
    icon: BookOpen,
    hint: "Stays in Notes and resurfaces on your dashboard to re-read.",
  },
  {
    value: "recall",
    label: "Recall",
    icon: Brain,
    hint: "Becomes a flashcard in Learn — not kept as a note.",
  },
];

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
  const createCard = useCreateCard();
  const router = useRouter();

  const [mode, setMode] = useState<NoteMode>(initialMode);
  const [kind, setKind] = useState<CaptureKind>("spark");
  // The existing note's kind (Spark/Revisit only). null = legacy note with no
  // kind — those keep the old flow and get no switcher.
  const [noteKind, setNoteKind] = useState<"spark" | "revisit" | null>(null);
  const [kindMenuOpen, setKindMenuOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [titleError, setTitleError] = useState(false);
  const [emptyError, setEmptyError] = useState(false);
  const [reformatState, setReformatState] = useState<
    "idle" | "loading" | "success"
  >("idle");
  const [reformatError, setReformatError] = useState<string | null>(null);
  const qc = useQueryClient();

  // Hydrate whenever the modal opens. New notes can only be edited.
  useEffect(() => {
    if (!open) return;
    setTitleError(false);
    setEmptyError(false);
    setKind("spark");
    setKindMenuOpen(false);
    setNoteKind(
      note && (note.kind === "spark" || note.kind === "revisit")
        ? note.kind
        : null
    );
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

  /** Persist; returns false (and flags the error) if validation fails. */
  function save(): boolean {
    const trimmed = title.trim();

    // Existing notes keep the legacy edit flow: title required (except Sparks,
    // which may be untitled), kind untouched.
    if (note) {
      if (!trimmed && note.kind !== "spark") {
        setTitleError(true);
        return false;
      }
      updateNote.mutate({ id: note.id, title: trimmed, content, tags });
      return true;
    }

    // Recall never becomes a note — it goes straight to Learn through the
    // same card-create path the Learn section uses. Title (or the note's
    // first words) is the card front; the full text is the back.
    if (kind === "recall") {
      if (!content.trim()) {
        setEmptyError(true);
        return false;
      }
      createCard.mutate({
        front: trimmed || markdownExcerpt(content, 100),
        back: content.trim(),
        deck_name: "Recall",
      });
      return true;
    }

    // Spark/Revisit: zero required fields beyond some text — the server
    // derives a title from the content when none is given.
    if (!trimmed && !content.trim()) {
      setEmptyError(true);
      return false;
    }
    createNote.mutate({ title: trimmed, content, tags, kind });
    return true;
  }

  // Switch an existing note between Spark and Revisit (the only legal move —
  // Recall is never a note). Optimistic locally; on success bust Next's Router
  // Cache so the server-rendered Dashboard Revisit section updates without a
  // manual refresh. On failure, revert to match the hook's cache rollback.
  async function switchKind(next: "spark" | "revisit") {
    setKindMenuOpen(false);
    if (!note || noteKind === null || next === noteKind) return;
    const previous = noteKind;
    setNoteKind(next);
    try {
      await updateNote.mutateAsync({ id: note.id, kind: next });
      router.refresh();
    } catch {
      setNoteKind(previous);
    }
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
      <DialogContent className="border-border bg-surface-raised sm:max-w-2xl [&>button]:hidden">
        {mode === "read" ? (
          <>
            <DialogHeader className="flex-row items-center justify-between space-y-0">
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="-ml-1 rounded-md p-1 text-muted-foreground hover:bg-border/50 hover:text-foreground active:scale-95"
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
                  className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-40"
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
                  className="text-[13px] font-medium text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                  Edit
                </button>
              </div>
            </DialogHeader>

            <div>
              {/* Kind switcher — reuses the mono-caps eyebrow from NoteCard.
                  Tapping it reveals a Spark/Revisit toggle. Legacy notes
                  (kind null) get no switcher and stay on the old flow. */}
              {noteKind && (
                <div className="mb-3">
                  {kindMenuOpen ? (
                    <div
                      role="radiogroup"
                      aria-label="Note kind"
                      className="inline-flex gap-1 rounded-lg border border-border bg-surface p-1"
                    >
                      {(["spark", "revisit"] as const).map((k) => {
                        const Icon = k === "spark" ? Zap : BookOpen;
                        const selected = noteKind === k;
                        return (
                          <button
                            key={k}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => switchKind(k)}
                            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] transition-colors ${
                              selected
                                ? "bg-surface-raised text-foreground"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <Icon className="h-3 w-3" aria-hidden />
                            {k}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Kind: ${noteKind}. Tap to change.`}
                      onClick={() => setKindMenuOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-md font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {noteKind === "spark" ? (
                        <Zap className="h-3 w-3" aria-hidden />
                      ) : (
                        <BookOpen className="h-3 w-3" aria-hidden />
                      )}
                      {noteKind}
                      <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
                    </button>
                  )}
                </div>
              )}


              {/* Untitled Sparks show no visual title — the body is the note.
                  Radix still needs a DialogTitle, so it goes sr-only. */}
              <DialogTitle
                className={
                  title.trim()
                    ? "mb-3 text-xl font-semibold leading-snug text-foreground"
                    : "sr-only"
                }
              >
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
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}

              {content.trim() ? (
                <div
                  className="prose-preview pb-4 text-foreground"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              ) : (
                <p className="text-[13px] italic text-muted-foreground/70">
                  This note is empty.
                </p>
              )}

              {note?.updated_at && (
                <p className="mt-6 text-[11px] text-muted-foreground/80">
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
                className="text-[13px] font-medium text-muted-foreground hover:text-foreground"
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
              {!note && (
                <div className="space-y-2">
                  <div
                    role="radiogroup"
                    aria-label="Save as"
                    className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface p-1"
                  >
                    {KIND_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      const selected = kind === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => {
                            setKind(opt.value);
                            setEmptyError(false);
                          }}
                          className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                            selected
                              ? "bg-surface-raised text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {KIND_OPTIONS.find((o) => o.value === kind)?.hint}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="note-title">Title</Label>
                <Input
                  id="note-title"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (titleError) setTitleError(false);
                    if (emptyError) setEmptyError(false);
                  }}
                  placeholder={note ? "Untitled note" : "Title (optional)"}
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
                      onChange={(e) => {
                        setContent(e.target.value);
                        if (emptyError) setEmptyError(false);
                      }}
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
                {emptyError && (
                  <p className="text-xs text-danger">
                    {kind === "recall" && !note
                      ? "Recall needs some text to remember."
                      : "Write something first."}
                  </p>
                )}
              </div>

              {/* Cards have no tags — hide the field for a Recall capture. */}
              {!(kind === "recall" && !note) && (
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
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                      >
                        #{tag}
                        <button
                          type="button"
                          aria-label={`Remove ${tag}`}
                          onClick={() =>
                            setTagsInput(tags.filter((t) => t !== tag).join(", "))
                          }
                          className="text-muted-foreground/70 hover:text-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              )}

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
