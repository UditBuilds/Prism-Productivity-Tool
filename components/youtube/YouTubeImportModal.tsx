"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Play, Loader2, AlertCircle } from "lucide-react";

import { extractVideoId } from "@/lib/youtube/extract";
import type { YoutubeErrorCode } from "@/lib/youtube/types";
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

interface YoutubeError {
  message: string;
  hint?: string;
}

/**
 * Paste a YouTube URL → server fetches captions, Groq writes a structured
 * markdown note tagged #youtube-import. Mirrors PDFUploadModal's visual
 * language; controlled by the Notes page via open/onClose (no UI store entry).
 */
export function YouTubeImportModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<YoutubeError | null>(null);

  // Reset to a clean state whenever the modal opens.
  useEffect(() => {
    if (open) {
      setUrl("");
      setGenerating(false);
      setError(null);
    }
  }, [open]);

  // extractVideoId is a pure (network-free) helper — safe for client validation.
  const canGenerate = extractVideoId(url) !== null && !generating;

  function handleClose() {
    if (generating) return; // don't close mid-request
    onClose();
  }

  async function handleGenerate() {
    if (!canGenerate) return;
    setError(null);
    setGenerating(true);
    try {
      const res = await fetch("/api/youtube/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const json = (await res.json()) as {
        data: { note: Note } | null;
        error:
          | { code: YoutubeErrorCode; message: string; hint: string }
          | string
          | null;
      };

      if (!res.ok || json.data === null || json.error) {
        const err = json.error;
        const message =
          typeof err === "string"
            ? err
            : err?.message ?? `Request failed (${res.status})`;
        const hint =
          typeof err === "object" && err !== null ? err.hint : undefined;
        setError({ message, hint });
        setGenerating(false);
        return;
      }

      qc.invalidateQueries({ queryKey: ["notes"] });
      toast.success(`Note created from “${json.data.note.title}”`);
      onClose();
    } catch {
      setError({
        message: "Couldn't reach the server — check your connection.",
      });
      setGenerating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5 text-accent" />
            Generate Note from YouTube
          </DialogTitle>
          <DialogDescription>
            Paste a YouTube link — AI turns its captions into a structured,
            tagged note. Works with videos that have captions.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
            <p className="flex items-start gap-2 text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error.message}</span>
            </p>
            {error.hint && (
              <p className="mt-1.5 pl-6 text-xs text-danger/70">{error.hint}</p>
            )}
          </div>
        )}

        {generating ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
            <p className="text-sm">Fetching captions &amp; writing your note…</p>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="youtube-url">YouTube URL</Label>
            <Input
              id="youtube-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
              placeholder="https://www.youtube.com/watch?v=…"
              autoFocus
              className="rounded-lg"
            />
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={generating}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleGenerate} disabled={!canGenerate}>
            Generate Note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
