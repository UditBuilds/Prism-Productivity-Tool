// Client-safe shared types for the YouTube → flashcards pipeline.
// No server-only imports here (mirrors lib/pdf/types.ts).

export type YoutubeErrorCode =
  | "INVALID_URL"
  | "NO_TRANSCRIPT"
  | "PRIVATE_VIDEO"
  | "GROQ_ERROR"
  | "NETWORK_ERROR";

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
};
