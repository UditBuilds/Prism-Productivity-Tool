// YouTube transcript + metadata helpers.
//
// extractVideoId / processTranscript / chunkTranscript are PURE (no network),
// so this module is safe to import from a client component for URL validation.
// fetchTranscript calls the Supadata HTTP API (server-side; reads
// SUPADATA_API_KEY) — chosen because scraping YouTube directly is IP-blocked
// from datacenter IPs like Vercel's.

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

// Supadata's YouTube transcript endpoint — works from datacenter IPs (Vercel),
// unlike scraping YouTube directly. Returns synchronously (no async job).
const SUPADATA_TRANSCRIPT_URL =
  "https://api.supadata.ai/v1/youtube/transcript";

/**
 * Fetch the transcript via the Supadata API. Requests segmented output
 * (text=false) so timing data is preserved, and maps Supadata's status codes
 * to a YoutubeExtractError. Supadata names the start time "offset" (ms); we
 * map it to our segment's "start".
 */
export async function fetchTranscript(
  videoId: string
): Promise<YoutubeTranscriptSegment[]> {
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) {
    throw new YoutubeExtractError(
      "NETWORK_ERROR",
      "SUPADATA_API_KEY environment variable is not set"
    );
  }

  let res: Response;
  try {
    const url = `${SUPADATA_TRANSCRIPT_URL}?videoId=${encodeURIComponent(
      videoId
    )}&text=false`;
    res = await fetch(url, { headers: { "x-api-key": apiKey } });
  } catch {
    throw new YoutubeExtractError(
      "NETWORK_ERROR",
      "Could not reach the transcript service"
    );
  }

  // Supadata signals "no transcript available" with 206 Partial Content.
  if (res.status === 206) {
    throw new YoutubeExtractError(
      "NO_TRANSCRIPT",
      "This video has no captions available"
    );
  }
  if (res.status === 404) {
    throw new YoutubeExtractError(
      "PRIVATE_VIDEO",
      "This video is private or unavailable"
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new YoutubeExtractError(
      "NETWORK_ERROR",
      "The transcript service rejected the API key"
    );
  }
  if (!res.ok) {
    throw new YoutubeExtractError(
      "NETWORK_ERROR",
      `Transcript service error (${res.status})`
    );
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new YoutubeExtractError(
      "NETWORK_ERROR",
      "Transcript service returned an unreadable response"
    );
  }

  const content =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>).content
      : undefined;
  if (!Array.isArray(content) || content.length === 0) {
    throw new YoutubeExtractError(
      "NO_TRANSCRIPT",
      "No transcript segments were returned"
    );
  }

  const segments: YoutubeTranscriptSegment[] = [];
  for (const raw of content) {
    if (typeof raw !== "object" || raw === null) continue;
    const seg = raw as Record<string, unknown>;
    if (typeof seg.text !== "string") continue;
    segments.push({
      text: seg.text,
      // Supadata's "offset" (ms) is our "start".
      start: typeof seg.offset === "number" ? seg.offset : 0,
      duration: typeof seg.duration === "number" ? seg.duration : 0,
    });
  }

  if (segments.length === 0) {
    throw new YoutubeExtractError(
      "NO_TRANSCRIPT",
      "No usable transcript segments were returned"
    );
  }

  return segments;
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
