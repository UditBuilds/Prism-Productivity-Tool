"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  FileText,
  Loader2,
  Trash2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Check,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui.store";
import { createClient } from "@/lib/supabase/client";
import {
  MODE_INFO,
  PDF_BUCKET,
  PDF_ERROR_HINTS,
  PDF_MAX_BYTES,
  RANGE_MAX_PAGES,
  type AnalyzeData,
  type AnalyzeMode,
  type PdfErrorCode,
} from "@/lib/pdf/types";
import type { Note } from "@/types/database";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardCountPills } from "@/components/shared/CardCountPills";

const CARD_COUNT_OPTIONS = [5, 10, 15, 20, 25, 30];
const MODES: AnalyzeMode[] = ["quick", "smart", "range"];

type Phase = "select" | "uploading" | "processing" | "preview" | "saving";

interface DraftCard {
  id: string;
  front: string;
  back: string;
}

interface PdfError {
  message: string;
  code?: PdfErrorCode;
}

function validateFile(file: File): string | null {
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return "Please choose a PDF file.";
  if (file.size > PDF_MAX_BYTES) return "PDF too large (max 25 MB).";
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Turn a messy PDF filename into a readable deck name. */
function cleanFilename(filename: string): string {
  return filename
    .replace(/\.pdf$/i, "")
    .replace(/^[_\-\s]*[a-zA-Z0-9]+\.[a-zA-Z]{2,4}[_\-\s]*/i, "")
    // removes domain prefixes like _OceanofPDF.com_
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** POST JSON and unwrap the { data, error } envelope, throwing on failure. */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { data: T | null; error: string | null };
  if (!res.ok || json.error || json.data === null) {
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  return json.data;
}

export function PDFUploadModal() {
  const open = useUIStore((s) => s.pdfModalOpen);
  const close = useUIStore((s) => s.closePdfModal);
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  // Storage path of an uploaded-but-not-yet-cleaned object (for cleanup).
  const uploadedPathRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>("select");
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<AnalyzeMode>("quick");
  const [pageStart, setPageStart] = useState("1");
  const [pageEnd, setPageEnd] = useState("10");
  const [cardCount, setCardCount] = useState(10);
  const [result, setResult] = useState<AnalyzeData | null>(null);
  const [cards, setCards] = useState<DraftCard[]>([]);
  const [deckName, setDeckName] = useState("");
  const [saveAsNote, setSaveAsNote] = useState(true);
  const [error, setError] = useState<PdfError | null>(null);
  const [dragging, setDragging] = useState(false);

  const busy =
    phase === "uploading" || phase === "processing" || phase === "saving";

  // Reset to a clean state whenever the modal opens.
  useEffect(() => {
    if (open) {
      setPhase("select");
      setFile(null);
      setMode("quick");
      setPageStart("1");
      setPageEnd("10");
      setCardCount(10);
      setResult(null);
      setCards([]);
      setDeckName("");
      setSaveAsNote(true);
      setError(null);
      setDragging(false);
    }
  }, [open]);

  /** Best-effort removal of an orphaned temp upload (server cleans the rest). */
  function cleanupOrphan() {
    const path = uploadedPathRef.current;
    if (!path) return;
    uploadedPathRef.current = null;
    void createClient().storage.from(PDF_BUCKET).remove([path]);
  }

  function handleClose() {
    if (busy) return; // don't close mid-request
    cleanupOrphan();
    close();
  }

  function selectFile(selected: File | undefined | null) {
    if (!selected) return;
    const validationError = validateFile(selected);
    if (validationError) {
      setError({ message: validationError, code: "FILE_TOO_LARGE" });
      return;
    }
    setError(null);
    setFile(selected);
  }

  // Range validity (client-side; the server re-validates).
  const rangeStart = parseInt(pageStart, 10);
  const rangeEnd = parseInt(pageEnd, 10);
  const rangeValid =
    Number.isFinite(rangeStart) &&
    Number.isFinite(rangeEnd) &&
    rangeStart >= 1 &&
    rangeEnd >= rangeStart &&
    rangeEnd - rangeStart + 1 <= RANGE_MAX_PAGES;

  const canAnalyze =
    !!file && !busy && (mode !== "range" || rangeValid);

  async function handleAnalyze() {
    if (!file || !canAnalyze) return;
    setError(null);

    const supabase = createClient();
    let path: string;

    // 1. Upload directly to private storage (bypasses the request-body limit).
    setPhase("uploading");
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const slug = file.name
        .toLowerCase()
        .replace(/[^a-z0-9.]+/g, "-")
        .replace(/-+/g, "-")
        .slice(-80);
      path = `${user.id}/${Date.now()}-${slug || "document.pdf"}`;

      const { error: uploadError } = await supabase.storage
        .from(PDF_BUCKET)
        .upload(path, file, {
          contentType: "application/pdf",
          upsert: false,
        });
      if (uploadError) throw new Error(uploadError.message);
      uploadedPathRef.current = path;
    } catch (e) {
      setError({
        message:
          e instanceof Error && e.message
            ? `Upload failed: ${e.message}`
            : "Upload failed",
        code: "STORAGE_FAILED",
      });
      setPhase("select");
      return;
    }

    // 2. Server-side analysis from storage.
    setPhase("processing");
    try {
      const res = await fetch("/api/pdf/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path,
          filename: file.name,
          mode,
          cardCount,
          ...(mode === "range"
            ? { pageStart: rangeStart, pageEnd: rangeEnd }
            : {}),
        }),
      });
      const json = (await res.json()) as {
        data: AnalyzeData | null;
        error: string | null;
        code?: PdfErrorCode;
      };
      // The server deletes the temp object whatever happens.
      uploadedPathRef.current = null;

      if (!res.ok || json.error || json.data === null) {
        setError({
          message: json.error ?? `Analysis failed (${res.status})`,
          code: json.code,
        });
        setPhase("select");
        return;
      }

      setResult(json.data);
      setCards(
        json.data.cards.map((c) => ({
          id: crypto.randomUUID(),
          front: c.front,
          back: c.back,
        }))
      );
      setDeckName(cleanFilename(json.data.filename));
      setPhase("preview");
    } catch {
      setError({
        message: "Couldn't reach the analyzer — check your connection.",
        code: "EXTRACT_FAILED",
      });
      setPhase("select");
    }
  }

  async function handleSave() {
    if (!result || cards.length === 0) return;
    setError(null);
    setPhase("saving");
    const deck = deckName.trim() || cleanFilename(result.filename) || "Default";

    try {
      let noteId: string | null = null;
      if (saveAsNote) {
        const note = await postJson<Note>("/api/notes", {
          title: cleanFilename(result.filename) || result.filename,
          content: result.extractedText,
          tags: ["pdf-import"],
        });
        noteId = note.id;
        qc.invalidateQueries({ queryKey: ["notes"] });
      }

      await postJson<unknown>(
        "/api/srs/cards",
        cards.map((c) => ({
          front: c.front,
          back: c.back,
          deck_name: deck,
          note_id: noteId,
        }))
      );
      qc.invalidateQueries({ queryKey: ["srs-cards"] });

      const n = cards.length;
      toast.success(
        `${n} card${n === 1 ? "" : "s"} added to ${deck} deck${
          saveAsNote ? " · Note saved" : ""
        }`
      );
      close();
    } catch (e) {
      setError({
        message: e instanceof Error ? e.message : "Failed to save.",
      });
      setPhase("preview"); // keep drafts so the user can retry
    }
  }

  function deleteCard(id: string) {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }

  const modeLabel = result ? MODE_INFO[result.mode].label : "";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-accent" />
            {phase === "preview" ? (
              <>
                Review Generated Cards
                <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
                  {cards.length}
                </span>
              </>
            ) : (
              "Generate Flashcards from PDF"
            )}
          </DialogTitle>
          {phase === "select" && (
            <DialogDescription>
              Upload a text-based PDF — AI extracts the content and creates
              spaced repetition cards. Scanned/image PDFs aren&apos;t supported.
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Inline error + recovery hint */}
        {error && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
            <p className="flex items-start gap-2 text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error.message}</span>
            </p>
            {error.code && PDF_ERROR_HINTS[error.code] && (
              <p className="mt-1.5 pl-6 text-xs text-danger/70">
                {PDF_ERROR_HINTS[error.code]}
              </p>
            )}
          </div>
        )}

        {/* SELECT — file, mode, range, count */}
        {phase === "select" && (
          <div className="space-y-4">
            <div>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(e) => selectFile(e.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  selectFile(e.dataTransfer.files?.[0]);
                }}
                className={cn(
                  "flex w-full flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-[border-color,background-color,box-shadow]",
                  dragging
                    ? "border-accent bg-accent/10 shadow-glow-accent"
                    : "border-border bg-surface hover:border-accent/40 hover:shadow-glow-accent-sm"
                )}
              >
                <FileText className="h-9 w-9 text-accent" />
                <span className="text-sm font-medium text-foreground">
                  {file ? "Choose a different PDF" : "Drop your PDF here or click to browse"}
                </span>
                <span className="text-xs text-muted-foreground">
                  Text-based PDFs only · Max 25 MB
                </span>
              </button>

              {file && (
                <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm">
                  <FileText className="h-4 w-4 shrink-0 text-accent" />
                  <span className="min-w-0 truncate text-foreground">
                    {file.name}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {formatBytes(file.size)}
                  </span>
                </div>
              )}
            </div>

            {/* Extraction mode */}
            <div className="space-y-2">
              <Label>Extraction mode</Label>
              <div className="space-y-1.5">
                {MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    aria-pressed={mode === m}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left",
                      mode === m
                        ? "border-accent/60 bg-accent/10"
                        : "border-border bg-surface hover:border-muted-foreground/40"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                        mode === m
                          ? "border-accent bg-accent"
                          : "border-muted-foreground/40"
                      )}
                    >
                      {mode === m && (
                        <Check className="h-3 w-3 text-accent-foreground" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        {MODE_INFO[m].label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {MODE_INFO[m].description}
                      </span>
                    </span>
                  </button>
                ))}
              </div>

              {mode === "range" && (
                <div className="flex items-center gap-2 pt-1">
                  <Input
                    type="number"
                    min={1}
                    value={pageStart}
                    onChange={(e) => setPageStart(e.target.value)}
                    className="h-9 w-24 rounded-lg"
                    aria-label="From page"
                    placeholder="From"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="number"
                    min={1}
                    value={pageEnd}
                    onChange={(e) => setPageEnd(e.target.value)}
                    className="h-9 w-24 rounded-lg"
                    aria-label="To page"
                    placeholder="To"
                  />
                  {!rangeValid && (
                    <span className="text-xs text-danger">
                      1 ≤ from ≤ to, max {RANGE_MAX_PAGES} pages
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Number of cards to generate</Label>
              <CardCountPills
                value={cardCount}
                onChange={setCardCount}
                options={CARD_COUNT_OPTIONS}
              />
            </div>
          </div>
        )}

        {/* UPLOADING / PROCESSING — staged progress */}
        {(phase === "uploading" || phase === "processing") && (
          <div className="space-y-3 py-6">
            {[
              { key: "upload", label: "Uploading PDF to secure storage" },
              {
                key: "analyze",
                label: "Extracting text & generating cards",
              },
            ].map((step, i) => {
              const isDone = phase === "processing" && i === 0;
              const isActive =
                (phase === "uploading" && i === 0) ||
                (phase === "processing" && i === 1);
              return (
                <div
                  key={step.key}
                  className={cn(
                    "flex items-center gap-3 text-sm",
                    isActive
                      ? "text-foreground"
                      : isDone
                        ? "text-muted-foreground"
                        : "text-muted-foreground/40"
                  )}
                >
                  {isDone ? (
                    <Check className="h-4 w-4 shrink-0 text-success" />
                  ) : isActive ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
                  ) : (
                    <span className="h-4 w-4 shrink-0 rounded-full border border-border" />
                  )}
                  {step.label}
                </div>
              );
            })}
            {file && (
              <p className="truncate pt-1 text-xs text-muted-foreground/60">
                {file.name} · {formatBytes(file.size)} ·{" "}
                {MODE_INFO[mode].label}
              </p>
            )}
          </div>
        )}

        {/* SAVING */}
        {phase === "saving" && (
          <div
            role="status"
            className="flex flex-col items-center justify-center gap-3 py-10 text-muted-foreground"
          >
            <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden />
            <p className="text-sm">Saving…</p>
          </div>
        )}

        {/* PREVIEW */}
        {phase === "preview" && result && (
          <div className="space-y-4">
            {result.sampled && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Large document — content was sampled across{" "}
                  {result.pagesUsed} of {result.pageCount} pages.
                </span>
              </div>
            )}

            {/* Analysis summary */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <FileText className="h-4 w-4 shrink-0 text-accent" />
              <span className="max-w-[12rem] truncate">
                {cleanFilename(result.filename)}
              </span>
              <span aria-hidden>·</span>
              <span>
                {result.pageCount} page{result.pageCount === 1 ? "" : "s"}
              </span>
              <span aria-hidden>·</span>
              <span>{modeLabel}</span>
              {result.chunkCount > 1 && (
                <>
                  <span aria-hidden>·</span>
                  <span>{result.chunkCount} sections analyzed</span>
                </>
              )}
            </div>

            <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
              {cards.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No cards left. Regenerate or cancel.
                </p>
              ) : (
                cards.map((card) => (
                  <div
                    key={card.id}
                    className="relative rounded-lg border border-border bg-surface p-3 pr-9"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {card.front}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {card.back}
                    </p>
                    <button
                      type="button"
                      aria-label="Remove card"
                      onClick={() => deleteCard(card.id)}
                      className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition hover:bg-surface-raised hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="pdf-deck">Deck name</Label>
              <Input
                id="pdf-deck"
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
                placeholder="Deck name for these cards"
                className="rounded-lg"
              />
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={saveAsNote}
                onChange={(e) => setSaveAsNote(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-accent"
              />
              Also save as a note
            </label>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {phase === "preview" && result ? (
            <>
              <Button type="button" variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleAnalyze}
                disabled={!file}
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                Regenerate
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={cards.length === 0}
              >
                Save {cards.length} card{cards.length === 1 ? "" : "s"}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={handleClose}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleAnalyze}
                disabled={!canAnalyze}
              >
                Generate Cards
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
