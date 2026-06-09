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
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui.store";
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

const MAX_BYTES = 4 * 1024 * 1024;
const CARD_COUNT_OPTIONS = [5, 10, 15, 20, 25, 30];

type Phase = "idle" | "uploading" | "preview" | "saving";

interface DraftCard {
  id: string;
  front: string;
  back: string;
}

interface AnalyzeResult {
  cards: { front: string; back: string }[];
  extractedText: string;
  filename: string;
  pageCount: number;
  truncated: boolean;
}

function validateFile(file: File): string | null {
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return "Please choose a PDF file.";
  if (file.size > MAX_BYTES) return "PDF too large (max 4MB).";
  return null;
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

  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [cards, setCards] = useState<DraftCard[]>([]);
  const [deckName, setDeckName] = useState("");
  const [cardCount, setCardCount] = useState(10);
  const [saveAsNote, setSaveAsNote] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const busy = phase === "uploading" || phase === "saving";

  // Reset to a clean idle state whenever the modal opens.
  useEffect(() => {
    if (open) {
      setPhase("idle");
      setFile(null);
      setResult(null);
      setCards([]);
      setDeckName("");
      setCardCount(10);
      setSaveAsNote(true);
      setError(null);
      setDragging(false);
    }
  }, [open]);

  function handleClose() {
    if (busy) return; // don't close mid-request
    close();
  }

  async function analyze(target: File) {
    setError(null);
    setPhase("uploading");
    try {
      const fd = new FormData();
      fd.append("file", target);
      fd.append("cardCount", String(cardCount));
      const res = await fetch("/api/pdf/analyze", { method: "POST", body: fd });
      const json = (await res.json()) as {
        data: AnalyzeResult | null;
        error: string | null;
      };
      if (!res.ok || json.error || json.data === null) {
        throw new Error(json.error ?? `Request failed (${res.status})`);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to analyze the PDF.");
      setPhase("idle");
    }
  }

  function selectFile(selected: File | undefined | null) {
    if (!selected) return;
    const validationError = validateFile(selected);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setFile(selected);
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
      setError(e instanceof Error ? e.message : "Failed to save.");
      setPhase("preview"); // keep drafts so the user can retry
    }
  }

  function deleteCard(id: string) {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }

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
          {phase === "idle" && (
            <DialogDescription>
              Upload a text-based PDF. AI will extract the content and create
              spaced repetition cards automatically.
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Inline error */}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* IDLE — drop zone + count selector */}
        {phase === "idle" && (
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
                  "flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors md:min-h-32",
                  dragging
                    ? "border-accent bg-accent/10"
                    : "border-border bg-surface hover:border-muted-foreground/40"
                )}
              >
                <FileText className="h-10 w-10 text-accent" />
                <span className="text-sm font-medium text-foreground">
                  Drop your PDF here or click to browse
                </span>
                <span className="text-xs text-muted-foreground">
                  Text-based PDFs only · Max 4MB
                </span>
              </button>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Text-based PDFs only — scanned images won&apos;t work
              </p>

              {/* Selected file (not yet uploading) */}
              {file && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm">
                  <FileText className="h-4 w-4 shrink-0 text-accent" />
                  <span className="truncate text-foreground">{file.name}</span>
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

        {/* UPLOADING */}
        {phase === "uploading" && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
            <p className="text-sm">Reading PDF and generating cards with AI…</p>
            {file && (
              <p className="max-w-full truncate text-xs">{file.name}</p>
            )}
          </div>
        )}

        {/* SAVING */}
        {phase === "saving" && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
            <p className="text-sm">Saving…</p>
          </div>
        )}

        {/* PREVIEW */}
        {phase === "preview" && result && (
          <div className="space-y-4">
            {result.truncated && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  PDF was large — cards generated from the first portion of
                  content.
                </span>
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="h-4 w-4 shrink-0 text-accent" />
              <span className="truncate">{cleanFilename(result.filename)}</span>
              <span className="shrink-0">
                · {result.pageCount} page{result.pageCount === 1 ? "" : "s"}
              </span>
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
                onClick={() => file && analyze(file)}
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
                onClick={() => file && analyze(file)}
                disabled={!file || busy}
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
