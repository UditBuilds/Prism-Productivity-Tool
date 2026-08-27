import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  EmptyGenerationError,
  generateNotesFromTranscript,
} from "@/lib/ai/client";
import {
  aiRateLimitHeaders,
  aiRateLimitMessage,
  checkAiRateLimit,
} from "@/lib/ai/rateLimit";
import {
  extractVideoId,
  fetchVideoTitle,
  fetchTranscript,
  processTranscript,
  chunkTranscript,
  YoutubeExtractError,
} from "@/lib/youtube/extract";
import {
  YOUTUBE_ERROR_HINTS,
  type YoutubeAnalyzeError,
  type YoutubeErrorCode,
} from "@/lib/youtube/types";
import type { Note } from "@/types/database";

// Transcript fetch + (possibly multiple) Groq calls need Node + time headroom.
export const runtime = "nodejs";
export const maxDuration = 60;

const CHUNK_CHARS = 8000;
// generateNotesFromTranscript rejects content under 100 chars.
const MIN_TRANSCRIPT_CHARS = 100;
/**
 * The request body carries no free text for the model — the transcript is
 * fetched server-side and chunked — so `url` is the only unbounded field.
 * Capped because extractVideoId runs five unanchored regexes over it; a
 * multi-megabyte string is pure scanning cost before anything else rejects it.
 * Real YouTube URLs are well under 200 characters.
 */
const MAX_URL_CHARS = 500;

interface YoutubeNotesSuccess {
  note: Note;
  videoId: string;
  videoTitle: string;
  /** Transcript chunks sent to the AI (up to 6); one markdown section each. */
  chunkCount: number;
  /**
   * Chunks lost to a TECHNICAL failure — typically a rate limit landing partway
   * through the sequence. Deliberately excludes chunks the model handled fine
   * but found nothing in: those produce no section either, yet retrying cannot
   * recover them, so flagging them would tell the user to retry for nothing.
   */
  chunksFailed: number;
  /** `chunksFailed > 0` — the note is missing a stretch that a retry may recover. */
  partial: boolean;
}

type SuccessBody = { data: YoutubeNotesSuccess; error: null };
type ErrorBody = { data: null; error: YoutubeAnalyzeError };

function ok(data: YoutubeNotesSuccess) {
  return NextResponse.json({ data, error: null } satisfies SuccessBody, {
    status: 200,
  });
}

function fail(
  code: YoutubeErrorCode,
  message: string,
  status: number,
  headers?: Record<string, string>
) {
  const body: ErrorBody = {
    data: null,
    error: { code, message, hint: YOUTUBE_ERROR_HINTS[code] },
  };
  return NextResponse.json(body, { status, headers });
}

// POST /api/youtube/notes — { url } → captions → Groq markdown note → notes row.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { data: null, error: "Unauthorized" },
      { status: 401 }
    );
  }

  // Shared per-user cap across all six AI routes — before the transcript fetch
  // and the (up to 6) per-chunk Groq calls this route makes.
  const rateLimit = checkAiRateLimit(user.id);
  if (!rateLimit.allowed) {
    return fail(
      "RATE_LIMITED",
      aiRateLimitMessage(rateLimit.retryAfterSeconds),
      429,
      aiRateLimitHeaders(rateLimit.retryAfterSeconds)
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return fail("INVALID_URL", "Invalid JSON body", 400);
  }

  const url = typeof body.url === "string" ? body.url : "";
  if (url.length > MAX_URL_CHARS) {
    return fail("INVALID_URL", "That doesn't look like a YouTube URL", 400);
  }
  const videoId = extractVideoId(url);
  if (!videoId) {
    return fail("INVALID_URL", "That doesn't look like a YouTube URL", 400);
  }

  try {
    // Title (never throws) and transcript fetch run together.
    const [videoTitle, segments] = await Promise.all([
      fetchVideoTitle(videoId),
      fetchTranscript(videoId),
    ]);

    const text = processTranscript(segments);
    if (text.length < MIN_TRANSCRIPT_CHARS) {
      return fail(
        "NO_TRANSCRIPT",
        "The transcript was too short to generate a note from",
        422
      );
    }

    const chunks = chunkTranscript(text, CHUNK_CHARS);

    // One markdown section per chunk (sequential — bounded Groq rate pressure).
    const sections: string[] = [];
    // Counted directly rather than derived as `chunks.length - sections.length`.
    // That subtraction cannot tell the two reasons a chunk yields no section
    // apart, and they need opposite treatment: a rate limit means "retry and
    // you may get it", an empty stretch of transcript means "there was nothing
    // here". Only the first is a failure.
    let chunksFailed = 0;
    for (const chunk of chunks) {
      try {
        const section = await generateNotesFromTranscript(videoTitle, chunk);
        const trimmed = section.trim();
        // A successful call that returns nothing is the same "nothing here"
        // case as EmptyGenerationError — no section, but nothing broke.
        if (trimmed) sections.push(trimmed);
      } catch (err) {
        if (err instanceof EmptyGenerationError) {
          console.warn("YouTube chunk had nothing to summarise:", err.message);
        } else {
          chunksFailed += 1;
          console.error("YouTube note generation failed for a chunk:", err);
        }
      }
    }

    if (sections.length === 0) {
      return fail("GROQ_ERROR", "Note generation failed for this video", 502);
    }

    // Merge multi-chunk output with a horizontal rule between sampled sections.
    const content = sections.join("\n\n---\n\n");

    const { data: note, error: insertError } = await supabase
      .from("notes")
      .insert({
        user_id: user.id,
        title: videoTitle, // fetchVideoTitle already falls back to "YouTube Notes"
        content,
        tags: ["youtube-import"],
      })
      .select()
      .single();

    if (insertError || !note) {
      console.error("YouTube note insert failed:", insertError);
      return fail(
        "GROQ_ERROR",
        "The note was generated but couldn't be saved",
        500
      );
    }

    return ok({
      note,
      videoId,
      videoTitle,
      chunkCount: chunks.length,
      chunksFailed,
      partial: chunksFailed > 0,
    });
  } catch (err) {
    if (err instanceof YoutubeExtractError) {
      const status =
        err.code === "NO_TRANSCRIPT"
          ? 422
          : err.code === "PRIVATE_VIDEO"
            ? 404
            : 502;
      return fail(err.code, err.message, status);
    }
    console.error("YouTube notes error:", err);
    return fail("NETWORK_ERROR", "Something went wrong analyzing this video", 500);
  }
}
