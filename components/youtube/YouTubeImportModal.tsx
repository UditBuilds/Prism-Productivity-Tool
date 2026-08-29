"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Play,
  Loader2,
  AlertCircle,
  Check,
  RotateCcw,
  FileText,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { extractVideoId } from "@/lib/youtube/extract";
import type {
  YoutubeErrorCode,
  YoutubeNoteJobProgress,
  YoutubeNoteJobSummary,
} from "@/lib/youtube/types";
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

type Phase = "input" | "starting" | "generating";

/**
 * Gap between continuation calls.
 *
 * This is NOT polling a background worker — each POST /continue performs one
 * section's generation synchronously and returns when it is done, so the loop
 * is already paced by Groq (seconds per call). The gap is deliberate spacing so
 * a client bug can't hammer the route, kept short because a 45-section lecture
 * pays it 45 times.
 */
const CONTINUE_GAP_MS = 500;

/**
 * Consecutive transient failures tolerated before the loop gives up. Giving up
 * does NOT lose work — the job row keeps its progress and the resume banner
 * offers it back on the next open.
 */
const MAX_TRANSIENT_RETRIES = 3;

const RETRYABLE: YoutubeErrorCode[] = ["RATE_LIMITED", "NETWORK_ERROR"];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ApiError {
  code: YoutubeErrorCode;
  message: string;
  hint: string;
}

interface StartData {
  jobId: string;
  totalChunks: number;
  videoId: string;
  videoTitle: string;
  completedChunks: number;
  chunksFailed: number;
  resumed: boolean;
}

function readError(
  err: ApiError | string | null | undefined,
  status: number
): YoutubeError {
  if (typeof err === "string") return { message: err };
  return {
    message: err?.message ?? `Request failed (${status})`,
    hint: err?.hint,
  };
}

/**
 * Paste a YouTube URL → the server plans a note job over the WHOLE transcript,
 * then writes it one section per request. Mirrors PDFUploadModal's
 * staged-progress language; controlled by the Notes page via open/onClose (no
 * UI store entry).
 *
 * The modal holds no generation state that matters. Everything needed to finish
 * a note lives in the youtube_note_jobs row, so closing this — or killing the
 * app outright — costs at most the section that was in flight.
 */
export function YouTubeImportModal({
  open,
  onClose,
  onViewNote,
}: {
  open: boolean;
  onClose: () => void;
  /** Open a saved note by id — used by the "already generated" branch. */
  onViewNote?: (noteId: string) => void;
}) {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [error, setError] = useState<YoutubeError | null>(null);
  const [videoTitle, setVideoTitle] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [chunksFailed, setChunksFailed] = useState(0);
  const [existingJob, setExistingJob] = useState<YoutubeNoteJobSummary | null>(
    null
  );

  // Flipped when the modal closes so an in-flight loop stops issuing requests.
  // The job itself loses nothing — it just waits to be resumed.
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!open) {
      cancelledRef.current = true;
      return;
    }
    cancelledRef.current = false;
    setUrl("");
    setPhase("input");
    setError(null);
    setVideoTitle("");
    setProgress({ done: 0, total: 0 });
    setChunksFailed(0);
    setExistingJob(null);

    // "Did I leave one half-written?" — any unfinished job, any video.
    let stale = false;
    fetch("/api/youtube/notes/job")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (stale || cancelledRef.current) return;
        const job = json?.data?.job as YoutubeNoteJobSummary | null | undefined;
        if (job) setExistingJob(job);
      })
      .catch(() => {
        // A failed lookup just means no banner. Never surface it as an error —
        // the user can still start a new note.
      });
    return () => {
      stale = true;
    };
  }, [open]);

  const videoId = extractVideoId(url);
  const busy = phase === "starting" || phase === "generating";

  // Once a real video id is typed, look that video up specifically — a job
  // already completed for it should offer the saved note rather than quietly
  // regenerate one.
  useEffect(() => {
    if (!open || !videoId || busy) return;
    let stale = false;
    const timer = setTimeout(() => {
      fetch(`/api/youtube/notes/job?videoId=${encodeURIComponent(videoId)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (stale) return;
          const job = json?.data?.job as
            | YoutubeNoteJobSummary
            | null
            | undefined;
          if (job && job.status !== "failed") setExistingJob(job);
        })
        .catch(() => {});
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [open, videoId, busy]);

  function handleClose() {
    // Closing mid-generation is allowed on purpose: progress is committed to
    // the job row after every section, so reopening resumes rather than
    // restarts. The single-shot version had to block this; this one doesn't.
    cancelledRef.current = true;
    onClose();
  }

  const finish = useCallback(
    (data: YoutubeNoteJobProgress) => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      const note = data.note as Note | undefined;
      const title = note?.title ?? data.videoTitle;
      // The note saved either way, so a partial result stays a notice rather
      // than an error — same wording as the single-shot version it replaces.
      // Without it a note missing a stretch of the video looks complete.
      if (data.partial) {
        toast(
          `Note created from “${title}” — ${data.chunksFailed} of ${data.progress.total} sections couldn't be generated, so part of the video is missing.`,
          { icon: "⚠️", duration: 8000 }
        );
      } else {
        toast.success(`Note created from “${title}”`);
      }
      onClose();
    },
    [qc, onClose]
  );

  /** Drive one job to completion, one section per request. */
  const runJob = useCallback(
    async (jobId: string, title: string, total: number, doneSoFar: number) => {
      setPhase("generating");
      setVideoTitle(title);
      setProgress({ done: doneSoFar, total });

      let transientFailures = 0;
      for (;;) {
        if (cancelledRef.current) return;

        let res: Response;
        try {
          res = await fetch("/api/youtube/notes/continue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId }),
          });
        } catch {
          transientFailures += 1;
          if (transientFailures > MAX_TRANSIENT_RETRIES) {
            if (cancelledRef.current) return;
            setError({
              message: "Couldn't reach the server.",
              hint: "Your progress is saved — reopen this to pick up where it stopped.",
            });
            setPhase("input");
            return;
          }
          await sleep(CONTINUE_GAP_MS * 2 * transientFailures);
          continue;
        }

        const json = (await res.json().catch(() => null)) as {
          data: YoutubeNoteJobProgress | null;
          error: ApiError | string | null;
        } | null;
        if (cancelledRef.current) return;

        if (!res.ok || !json?.data) {
          const code =
            typeof json?.error === "object" && json.error !== null
              ? json.error.code
              : undefined;

          if (code && RETRYABLE.includes(code)) {
            transientFailures += 1;
            if (transientFailures <= MAX_TRANSIENT_RETRIES) {
              const retryAfter = Number(res.headers.get("Retry-After"));
              await sleep(
                Number.isFinite(retryAfter) && retryAfter > 0
                  ? retryAfter * 1000
                  : CONTINUE_GAP_MS * 2 * transientFailures
              );
              continue;
            }
          }
          setError(readError(json?.error, res.status));
          setPhase("input");
          return;
        }

        transientFailures = 0;
        const data = json.data;
        setProgress(data.progress);
        setChunksFailed(data.chunksFailed);

        if (data.done) {
          finish(data);
          return;
        }
        await sleep(CONTINUE_GAP_MS);
      }
    },
    [finish]
  );

  /**
   * Plan a job for `rawUrl` and drive it. `restart: true` is the "Start over"
   * branch — it discards any unfinished job for the same video first.
   */
  const startJob = useCallback(
    async (rawUrl: string, restart: boolean) => {
      setError(null);
      setExistingJob(null);
      setPhase("starting");

      let res: Response;
      try {
        res = await fetch("/api/youtube/notes/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: rawUrl.trim(), restart }),
        });
      } catch {
        setError({
          message: "Couldn't reach the server — check your connection.",
        });
        setPhase("input");
        return;
      }

      const json = (await res.json().catch(() => null)) as {
        data: StartData | null;
        error: ApiError | string | null;
      } | null;
      if (cancelledRef.current) return;

      if (!res.ok || !json?.data) {
        setError(readError(json?.error, res.status));
        setPhase("input");
        return;
      }

      const data = json.data;
      setChunksFailed(data.chunksFailed);
      await runJob(
        data.jobId,
        data.videoTitle,
        data.totalChunks,
        data.completedChunks + data.chunksFailed
      );
    },
    [runJob]
  );

  function resumeExisting() {
    if (!existingJob) return;
    const job = existingJob;
    setExistingJob(null);
    setError(null);
    void runJob(
      job.jobId,
      job.videoTitle,
      job.totalChunks,
      job.completedChunks + job.chunksFailed
    );
  }

  const canGenerate = videoId !== null && !busy;
  const resumable =
    existingJob !== null &&
    (existingJob.status === "pending" || existingJob.status === "processing");
  const completedJob =
    existingJob !== null && existingJob.status === "completed"
      ? existingJob
      : null;

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
            tagged note. The whole video is covered, however long it runs.
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

        {/* RESUME — an unfinished job is waiting. */}
        {!busy && resumable && existingJob && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <p className="flex items-start gap-2 text-warning">
              <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                “{existingJob.videoTitle}” is part-written —{" "}
                {existingJob.completedChunks + existingJob.chunksFailed} of{" "}
                {existingJob.totalChunks} sections done.
              </span>
            </p>
            <div className="mt-2 flex gap-2 pl-6">
              <Button type="button" size="sm" onClick={resumeExisting}>
                Continue
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  const rawUrl = existingJob.videoUrl;
                  setUrl(rawUrl);
                  void startJob(rawUrl, true);
                }}
              >
                Start over
              </Button>
            </div>
          </div>
        )}

        {/* ALREADY DONE — don't silently regenerate a note they already have. */}
        {!busy && completedJob && (
          <div className="rounded-lg border border-border bg-surface-raised p-3 text-sm">
            <p className="flex items-start gap-2 text-muted-foreground">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <span>
                A note from “{completedJob.videoTitle}” was already generated.
              </span>
            </p>
            <div className="mt-2 flex gap-2 pl-6">
              {completedJob.noteId && onViewNote && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => onViewNote(completedJob.noteId as string)}
                >
                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                  View saved note
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setExistingJob(null)}
              >
                Generate again
              </Button>
            </div>
          </div>
        )}

        {busy ? (
          <div className="space-y-3 py-6">
            {[
              { key: "plan", label: "Fetching captions & planning sections" },
              {
                key: "write",
                label:
                  progress.total > 0
                    ? `Writing notes — section ${Math.min(
                        progress.done + 1,
                        progress.total
                      )} of ${progress.total}`
                    : "Writing notes",
              },
            ].map((step, i) => {
              const isDone = phase === "generating" && i === 0;
              const isActive =
                (phase === "starting" && i === 0) ||
                (phase === "generating" && i === 1);
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

            {progress.total > 0 && (
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.done}
                className="h-1 w-full overflow-hidden rounded-full bg-surface-raised"
              >
                <div
                  className="h-full bg-accent transition-all"
                  style={{
                    width: `${Math.round(
                      (progress.done / progress.total) * 100
                    )}%`,
                  }}
                />
              </div>
            )}

            {videoTitle && (
              <p className="truncate pt-1 text-xs text-muted-foreground/60">
                {videoTitle}
              </p>
            )}
            {chunksFailed > 0 && (
              <p className="text-xs text-warning">
                {chunksFailed} section{chunksFailed === 1 ? "" : "s"} failed so
                far — the rest of the note is unaffected.
              </p>
            )}
            <p className="pt-1 text-xs text-muted-foreground/60">
              You can close this — progress is saved after every section, and
              reopening picks up where it stopped. If notifications are on we
              may ping you when it finishes, but that isn&apos;t guaranteed.
            </p>
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
                  if (canGenerate) void startJob(url, false);
                }
              }}
              placeholder="https://www.youtube.com/watch?v=…"
              autoFocus
              className="rounded-lg"
            />
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="ghost" onClick={handleClose}>
            {busy ? "Close" : "Cancel"}
          </Button>
          <Button
            type="button"
            onClick={() => void startJob(url, false)}
            disabled={!canGenerate}
          >
            Generate Note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
