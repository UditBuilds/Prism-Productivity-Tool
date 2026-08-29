// SERVER-ONLY helpers shared by the three /api/youtube/notes/* routes.
// Imports fetchTranscript (which reads SUPADATA_API_KEY) — never import this
// from a client component.

import {
  YoutubeExtractError,
  chunkTranscriptSequential,
  fetchTranscript,
  processTranscript,
} from "./extract";
import type { YoutubeNoteJob } from "@/types/database";

/**
 * Target size of one transcript chunk, in characters.
 *
 * The single-shot route used 8000 and asked for at most 6 of them. This is
 * smaller ON PURPOSE: chunk size now sets the unit of work for ONE HTTP
 * request, not the whole job. ~4000 chars is roughly 2-3 minutes of speech and
 * generates in a few seconds, which keeps every /continue call far inside the
 * 60s function ceiling — the failure mode this feature exists to remove. It
 * also bounds the blast radius of a failed chunk: losing one 4000-char window
 * costs a couple of minutes of the video, not eight thousand characters of it.
 */
export const NOTE_CHUNK_CHARS = 4000;

/** generateNotesFromTranscript rejects content under 100 chars. */
export const MIN_TRANSCRIPT_CHARS = 100;

/**
 * `url` is the only unbounded field either route accepts. Capped because
 * extractVideoId runs five unanchored regexes over it; a multi-megabyte string
 * is pure scanning cost before anything else rejects it. Real YouTube URLs are
 * well under 200 characters.
 */
export const MAX_URL_CHARS = 500;

/** Separator between per-chunk markdown sections in the assembled note. */
export const SECTION_SEPARATOR = "\n\n---\n\n";

/** Thrown when a re-derived chunk list no longer matches the job's plan. */
export class TranscriptChangedError extends Error {
  constructor(expected: number, actual: number) {
    super(
      `Transcript now yields ${actual} chunks, job was planned for ${expected}`
    );
    this.name = "TranscriptChangedError";
  }
}

/**
 * In-memory transcript-chunk cache, keyed by job id.
 *
 * WHY THIS EXISTS: youtube_note_jobs deliberately does not store the
 * transcript, so /continue has to re-derive the chunk list. Deriving it means
 * one Supadata fetch, which is a metered third-party call — a 45-chunk lecture
 * would otherwise cost 45 transcript fetches to produce one note. On a warm
 * instance this collapses that to one.
 *
 * IT IS A CACHE, NOT STATE. Serverless instances share no memory, so a miss is
 * normal and always falls back to a real fetch; correctness never depends on a
 * hit. chunkTranscriptSequential is pure, so a refetch reproduces byte-identical
 * chunks and the job's chunk index stays meaningful across instances.
 */
const CHUNK_CACHE_TTL_MS = 30 * 60_000;
const CHUNK_CACHE_MAX_JOBS = 20;
const chunkCache = new Map<string, { chunks: string[]; at: number }>();

function pruneChunkCache(now: number): void {
  // Array.from: tsconfig has no `target`, so Map iterators can't be for…of'd.
  for (const key of Array.from(chunkCache.keys())) {
    const entry = chunkCache.get(key);
    if (!entry || now - entry.at > CHUNK_CACHE_TTL_MS) chunkCache.delete(key);
  }
  // Still over budget after expiry: drop oldest-first.
  if (chunkCache.size > CHUNK_CACHE_MAX_JOBS) {
    const byAge = Array.from(chunkCache.entries()).sort(
      (a, b) => a[1].at - b[1].at
    );
    for (const [key] of byAge.slice(0, chunkCache.size - CHUNK_CACHE_MAX_JOBS)) {
      chunkCache.delete(key);
    }
  }
}

export function cacheJobChunks(jobId: string, chunks: string[]): void {
  const now = Date.now();
  chunkCache.set(jobId, { chunks, at: now });
  pruneChunkCache(now);
}

export function dropJobChunks(jobId: string): void {
  chunkCache.delete(jobId);
}

/** Test/diagnostic only. */
export function __peekJobChunkCache(jobId: string): number | null {
  return chunkCache.get(jobId)?.chunks.length ?? null;
}

/**
 * The chunk list for a job — from cache when this instance has it, otherwise
 * re-derived from the video.
 *
 * Throws TranscriptChangedError when the re-derived list is a different length
 * than the job was planned for. That mismatch means chunk N is no longer the
 * same stretch of video, so continuing would append content from the wrong
 * place and silently skip another; failing the job is the honest outcome.
 * Throws YoutubeExtractError if the transcript can't be fetched at all.
 */
export async function loadJobChunks(
  job: Pick<YoutubeNoteJob, "id" | "video_id" | "total_chunks">
): Promise<string[]> {
  const cached = chunkCache.get(job.id);
  if (cached && Date.now() - cached.at <= CHUNK_CACHE_TTL_MS) {
    return cached.chunks;
  }

  const segments = await fetchTranscript(job.video_id);
  const text = processTranscript(segments);
  if (text.length < MIN_TRANSCRIPT_CHARS) {
    throw new YoutubeExtractError(
      "NO_TRANSCRIPT",
      "The transcript was too short to generate a note from"
    );
  }
  const chunks = chunkTranscriptSequential(text, NOTE_CHUNK_CHARS);
  if (chunks.length !== job.total_chunks) {
    throw new TranscriptChangedError(job.total_chunks, chunks.length);
  }
  cacheJobChunks(job.id, chunks);
  return chunks;
}

/**
 * Index of the next unprocessed chunk. Processed = succeeded + failed, because
 * a failed chunk is skipped rather than retried (the chunksFailed/partial
 * contract inherited from the single-shot route). This is the whole resume
 * mechanism: it is derived from two committed integers, so reopening the app
 * lands on exactly the chunk that was next.
 */
export function nextChunkIndex(
  job: Pick<YoutubeNoteJob, "completed_chunks" | "chunks_failed">
): number {
  return job.completed_chunks + job.chunks_failed;
}

/** Append one markdown section to the note assembled so far. */
export function appendSection(existing: string, section: string): string {
  return existing ? `${existing}${SECTION_SEPARATOR}${section}` : section;
}
