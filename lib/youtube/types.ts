// Client-safe shared types for the YouTube → flashcards and YouTube → note
// pipelines. No server-only imports here (mirrors lib/pdf/types.ts).

import type { Note, YoutubeNoteJobStatus } from "@/types/database";

export type YoutubeErrorCode =
  | "INVALID_URL"
  | "NO_TRANSCRIPT"
  | "PRIVATE_VIDEO"
  | "GROQ_ERROR"
  | "NETWORK_ERROR"
  | "RATE_LIMITED"
  // Note-job only. /api/youtube/analyze never emits these; they are in the
  // shared union because both pipelines share this error envelope and hint map.
  | "JOB_NOT_FOUND"
  | "TRANSCRIPT_CHANGED";

export interface YoutubeTranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

export interface YoutubeAnalyzeRequest {
  url: string;
  cardCount: number;
  deckName?: string;
}

export interface YoutubeAnalyzeError {
  code: YoutubeErrorCode;
  message: string;
  hint: string;
}

export interface GeneratedYoutubeCard {
  front: string;
  back: string;
}

export interface YoutubeAnalyzeSuccess {
  cards: GeneratedYoutubeCard[];
  videoId: string;
  videoTitle: string;
  transcriptLength: number;
  /** Transcript chunks sent to the AI (up to 6). */
  chunkCount: number;
  /**
   * Chunks lost to a TECHNICAL failure — in practice a rate limit landing
   * partway through the sequence. Without this, "fewer cards because chunks
   * failed" and "fewer cards because the content only supported that many" are
   * the same HTTP 200 with a short array.
   *
   * Excludes chunks the model processed successfully but found nothing worth a
   * card in (an intro, a sponsor read, a silence). Those also yield no cards,
   * but retrying cannot recover them, so counting them would raise the partial
   * flag on a perfectly healthy video.
   */
  chunksFailed: number;
  /** `chunksFailed > 0` — some cards are missing and a retry may recover them. */
  partial: boolean;
}

/** Human recovery hint per error code (shown under the error message). */
export const YOUTUBE_ERROR_HINTS: Record<YoutubeErrorCode, string> = {
  INVALID_URL:
    "Paste a full YouTube link, e.g. https://www.youtube.com/watch?v=…",
  NO_TRANSCRIPT:
    "This video has no captions. Try a video with auto-generated subtitles.",
  PRIVATE_VIDEO: "This video is private or unavailable.",
  NETWORK_ERROR:
    "Could not reach YouTube. The video may be region-restricted or age-gated.",
  GROQ_ERROR: "AI generation failed. Try again or reduce card count.",
  RATE_LIMITED:
    "You've made a lot of AI requests in the last minute. Wait a moment and try again.",
  JOB_NOT_FOUND:
    "This note job no longer exists. Start a new one from the video link.",
  TRANSCRIPT_CHANGED:
    "The video's captions changed while the note was being written. Start over to pick up the new version.",
};

/**
 * One /continue response. `progress.done` counts chunks PROCESSED
 * (succeeded + failed), which is what "chunk X of Y" should show — a job
 * advances past a failed chunk rather than retrying it, so counting only
 * successes would make the bar stall on a partial run.
 */
export interface YoutubeNoteJobProgress {
  jobId: string;
  done: boolean;
  progress: { done: number; total: number };
  partialContent: string;
  chunksFailed: number;
  /** `chunksFailed > 0` — the note is missing a stretch a retry may recover. */
  partial: boolean;
  videoTitle: string;
  /** Only on the response that completes the job. */
  note?: Note;
}

/** GET /api/youtube/notes/job — the resume/"already done" lookup. */
export interface YoutubeNoteJobSummary {
  jobId: string;
  videoId: string;
  videoUrl: string;
  videoTitle: string;
  status: YoutubeNoteJobStatus;
  completedChunks: number;
  chunksFailed: number;
  totalChunks: number;
  /** Resolved for completed jobs so the UI can link to the saved note. */
  noteId: string | null;
}
