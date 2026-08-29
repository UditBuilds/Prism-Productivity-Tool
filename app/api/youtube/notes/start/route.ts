import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
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
  chunkTranscriptSequential,
  YoutubeExtractError,
} from "@/lib/youtube/extract";
import {
  MAX_URL_CHARS,
  MIN_TRANSCRIPT_CHARS,
  NOTE_CHUNK_CHARS,
  cacheJobChunks,
  dropJobChunks,
} from "@/lib/youtube/job";
import {
  YOUTUBE_ERROR_HINTS,
  type YoutubeAnalyzeError,
  type YoutubeErrorCode,
} from "@/lib/youtube/types";

// Transcript fetch needs Node. No Groq call happens here, so this route is
// fast regardless of video length — the per-chunk work lives in /continue.
export const runtime = "nodejs";
export const maxDuration = 60;

interface StartSuccess {
  jobId: string;
  totalChunks: number;
  videoId: string;
  videoTitle: string;
  /** How many chunks are already done — non-zero when an existing job was returned. */
  completedChunks: number;
  chunksFailed: number;
  /** True when this returned an existing in-progress job instead of creating one. */
  resumed: boolean;
}

type ErrorBody = { data: null; error: YoutubeAnalyzeError };

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

/**
 * POST /api/youtube/notes/start — plan a note job.
 *
 * Fetches the captions, splits the WHOLE transcript into consecutive chunks
 * (no sampling, no cap) and writes one youtube_note_jobs row. Returns
 * immediately; nothing is generated here. The client then drives
 * /api/youtube/notes/continue once per chunk.
 *
 * Body: { url, restart? }. `restart: true` discards any in-progress job for
 * this user+video first — that is the "Start Over" branch of the resume
 * banner. Without it, an existing pending/processing job for the same video is
 * RETURNED rather than duplicated, so a double submit resumes instead of
 * running the same video twice.
 */
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

  // Stays on the SHARED interactive tier. This is the user-initiated action
  // and the thing worth capping; /continue has its own budget precisely so
  // this one can stay tight. See lib/ai/rateLimit.ts.
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
  const restart = body.restart === true;
  if (url.length > MAX_URL_CHARS) {
    return fail("INVALID_URL", "That doesn't look like a YouTube URL", 400);
  }
  const videoId = extractVideoId(url);
  if (!videoId) {
    return fail("INVALID_URL", "That doesn't look like a YouTube URL", 400);
  }

  try {
    // RLS already scopes this to the caller; .eq("user_id") is belt-and-braces
    // and makes the ownership boundary readable at the call site.
    const { data: existing } = await supabase
      .from("youtube_note_jobs")
      .select("*")
      .eq("user_id", user.id)
      .eq("video_id", videoId)
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing && !restart) {
      return NextResponse.json({
        data: {
          jobId: existing.id,
          totalChunks: existing.total_chunks,
          videoId: existing.video_id,
          videoTitle: existing.video_title ?? "YouTube Notes",
          completedChunks: existing.completed_chunks,
          chunksFailed: existing.chunks_failed,
          resumed: true,
        } satisfies StartSuccess,
        error: null,
      });
    }

    if (existing && restart) {
      // Drop every unfinished job for this video, not just the newest, so
      // "Start Over" can't leave an older row behind to be resumed later.
      const { data: killed } = await supabase
        .from("youtube_note_jobs")
        .delete()
        .eq("user_id", user.id)
        .eq("video_id", videoId)
        .in("status", ["pending", "processing"])
        .select("id");
      for (const row of killed ?? []) dropJobChunks(row.id);
    }

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

    // FULL coverage: every character lands in exactly one chunk, in order.
    // The count is whatever the video needs — a 2-minute clip is 1, a 2-hour
    // lecture is ~45. There is no cap; the old 6-window sample is gone.
    const chunks = chunkTranscriptSequential(text, NOTE_CHUNK_CHARS);
    if (chunks.length === 0) {
      return fail(
        "NO_TRANSCRIPT",
        "The transcript was too short to generate a note from",
        422
      );
    }

    const { data: job, error: insertError } = await supabase
      .from("youtube_note_jobs")
      .insert({
        user_id: user.id,
        video_id: videoId,
        video_title: videoTitle,
        video_url: url.trim(),
        total_chunks: chunks.length,
        status: "pending",
      })
      .select()
      .single();

    if (insertError || !job) {
      console.error("YouTube note job insert failed:", insertError);
      return fail("GROQ_ERROR", "Couldn't start the note job", 500);
    }

    // Warm this instance's cache so the first /continue usually skips a second
    // transcript fetch. Purely an optimisation — see loadJobChunks.
    cacheJobChunks(job.id, chunks);

    return NextResponse.json({
      data: {
        jobId: job.id,
        totalChunks: job.total_chunks,
        videoId,
        videoTitle,
        completedChunks: 0,
        chunksFailed: 0,
        resumed: false,
      } satisfies StartSuccess,
      error: null,
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
    console.error("YouTube note job start error:", err);
    return fail(
      "NETWORK_ERROR",
      "Something went wrong analyzing this video",
      500
    );
  }
}
