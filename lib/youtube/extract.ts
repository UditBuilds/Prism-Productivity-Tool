// YouTube transcript + metadata helpers.
//
// extractVideoId / processTranscript / chunkTranscript are PURE (no network,
// no youtube-transcript import) so this module is safe to import from a client
// component for URL validation. fetchTranscript lazily imports the
// youtube-transcript package so the package never lands in the client bundle.

import type {
  YoutubeErrorCode,
  YoutubeTranscriptSegment,
} from "./types";

/** Thrown by fetchTranscript with a typed code the route maps to a response. */
export class YoutubeExtractError extends Error {
  code: YoutubeErrorCode;
  constructor(code: YoutubeErrorCode, message: string) {
    super(message);
    this.name = "YoutubeExtractError";
    this.code = code;
  }
}

const ID = "[A-Za-z0-9_-]{11}";
// watch?v= / youtu.be / embed / shorts / live — not anchored, so www. and m.
// subdomains and trailing query params (&list=, ?t=) are all tolerated.
const ID_PATTERNS: RegExp[] = [
  new RegExp(`youtube\\.com/watch\\?(?:.*&)?v=(${ID})`),
  new RegExp(`youtu\\.be/(${ID})`),
  new RegExp(`youtube\\.com/embed/(${ID})`),
  new RegExp(`youtube\\.com/shorts/(${ID})`),
  new RegExp(`youtube\\.com/live/(${ID})`),
];

/** Pull the 11-char video id out of any common YouTube URL, or null. */
export function extractVideoId(url: string): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  for (const re of ID_PATTERNS) {
    const match = trimmed.match(re);
    if (match) return match[1];
  }
  return null;
}

/**
 * Fetch a video's title via YouTube's free oEmbed endpoint (no API key).
 * Never throws — returns "YouTube Notes" on any failure.
 */
export async function fetchVideoTitle(videoId: string): Promise<string> {
  const FALLBACK = "YouTube Notes";
  try {
    const target = `https://www.youtube.com/watch?v=${videoId}`;
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        target
      )}&format=json`
    );
    if (!res.ok) return FALLBACK;
    const data: unknown = await res.json();
    if (
      typeof data === "object" &&
      data !== null &&
      typeof (data as Record<string, unknown>).title === "string"
    ) {
      const title = ((data as Record<string, unknown>).title as string).trim();
      return title || FALLBACK;
    }
    return FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/**
 * Fetch the transcript, preferring English then falling back to any available
 * language. Maps youtube-transcript's typed errors to a YoutubeExtractError.
 */
export async function fetchTranscript(
  videoId: string
): Promise<YoutubeTranscriptSegment[]> {
  // Lazy import keeps youtube-transcript out of the client bundle.
  const {
    YoutubeTranscript,
    YoutubeTranscriptDisabledError,
    YoutubeTranscriptNotAvailableError,
    YoutubeTranscriptNotAvailableLanguageError,
    YoutubeTranscriptVideoUnavailableError,
    YoutubeTranscriptTooManyRequestError,
  } = await import("youtube-transcript");

  try {
    let rows: { text: string; duration: number; offset: number }[];
    try {
      rows = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
    } catch (err) {
      // English specifically unavailable → retry with the default track.
      if (err instanceof YoutubeTranscriptNotAvailableLanguageError) {
        rows = await YoutubeTranscript.fetchTranscript(videoId);
      } else {
        throw err;
      }
    }

    if (!rows || rows.length === 0) {
      throw new YoutubeExtractError(
        "NO_TRANSCRIPT",
        "No transcript segments were returned"
      );
    }
    // youtube-transcript reports the timestamp as `offset`; our segment uses `start`.
    return rows.map((r) => ({
      text: r.text,
      start: r.offset,
      duration: r.duration,
    }));
  } catch (err) {
    if (err instanceof YoutubeExtractError) throw err;
    if (
      err instanceof YoutubeTranscriptDisabledError ||
      err instanceof YoutubeTranscriptNotAvailableError ||
      err instanceof YoutubeTranscriptNotAvailableLanguageError
    ) {
      throw new YoutubeExtractError(
        "NO_TRANSCRIPT",
        "This video has no captions available"
      );
    }
    if (err instanceof YoutubeTranscriptVideoUnavailableError) {
      throw new YoutubeExtractError(
        "PRIVATE_VIDEO",
        "This video is private or unavailable"
      );
    }
    if (err instanceof YoutubeTranscriptTooManyRequestError) {
      throw new YoutubeExtractError(
        "NETWORK_ERROR",
        "YouTube rate-limited the request — try again shortly"
      );
    }
    throw new YoutubeExtractError(
      "NETWORK_ERROR",
      "Could not reach YouTube for this video"
    );
  }
}

// Caption noise tokens: [Music], [Applause], ♪ … — stripped before generation.
const NOISE_RE =
  /\[(?:music|applause|laughter|cheering|cheers|silence|inaudible|background\s+noise|sound\s+effects?|crowd\s+\w+)\]/gi;

/** Join segments into clean plain text with caption noise stripped. */
export function processTranscript(
  segments: YoutubeTranscriptSegment[]
): string {
  return segments
    .map((s) => s.text)
    .join(" ")
    .replace(NOISE_RE, " ")
    .replace(/♪+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Chunk the transcript for generation. If the text fits in maxChunkChars,
 * return it whole; otherwise sample up to 6 windows of ~4000 chars spaced
 * evenly across the transcript (same even-sampling idea as lib/pdf/chunk.ts).
 */
export function chunkTranscript(
  text: string,
  maxChunkChars: number
): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length === 0) return [];
  if (clean.length <= maxChunkChars) return [clean];

  const WINDOW = 4000;
  const MAX_CHUNKS = 6;
  const count = Math.min(MAX_CHUNKS, Math.ceil(clean.length / WINDOW));
  if (count <= 1) return [clean.slice(0, WINDOW)];

  const span = clean.length - WINDOW; // last window starts here
  const chunks: string[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.round((i * span) / (count - 1));
    chunks.push(clean.slice(start, start + WINDOW));
  }
  return chunks;
}
