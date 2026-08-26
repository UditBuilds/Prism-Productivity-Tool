// Client-safe shared types for the YouTube → flashcards pipeline.
// No server-only imports here (mirrors lib/pdf/types.ts).

export type YoutubeErrorCode =
  | "INVALID_URL"
  | "NO_TRANSCRIPT"
  | "PRIVATE_VIDEO"
  | "GROQ_ERROR"
  | "NETWORK_ERROR"
  | "RATE_LIMITED";

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
   * Chunks that produced nothing because generation failed — in practice a
   * rate limit landing partway through the sequence. Without this, "fewer
   * cards because chunks failed" and "fewer cards because the content only
   * supported that many" are the same HTTP 200 with a short array.
   */
  chunksFailed: number;
  /** `chunksFailed > 0`. */
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
};
