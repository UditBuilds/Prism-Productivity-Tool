import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  EmptyGenerationError,
  generateNotesFromTranscript,
} from "@/lib/ai/client";
import {
  aiRateLimitHeaders,
  aiRateLimitMessage,
  checkYoutubeContinueRateLimit,
} from "@/lib/ai/rateLimit";
import { sendPushToUser } from "@/lib/push/send";
import { YoutubeExtractError } from "@/lib/youtube/extract";
import {
  TranscriptChangedError,
  appendSection,
  dropJobChunks,
  loadJobChunks,
  nextChunkIndex,
} from "@/lib/youtube/job";
import {
  YOUTUBE_ERROR_HINTS,
  type YoutubeAnalyzeError,
  type YoutubeErrorCode,
  type YoutubeNoteJobProgress,
} from "@/lib/youtube/types";
import type { Note, YoutubeNoteJob } from "@/types/database";

// ONE Groq call per request. That is what makes video length irrelevant to the
// function ceiling: a 2-hour lecture is 45 requests of a few seconds each, not
// one request of 45 chunks that blows through 60s and returns nothing.
export const runtime = "nodejs";
export const maxDuration = 60;

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

function progressOf(
  job: YoutubeNoteJob,
  extra: { done: boolean; note?: Note }
): YoutubeNoteJobProgress {
  return {
    jobId: job.id,
    done: extra.done,
    progress: {
      done: job.completed_chunks + job.chunks_failed,
      total: job.total_chunks,
    },
    partialContent: job.partial_content,
    chunksFailed: job.chunks_failed,
    partial: job.chunks_failed > 0,
    videoTitle: job.video_title ?? "YouTube Notes",
    ...(extra.note ? { note: extra.note } : {}),
  };
}

function ok(body: YoutubeNoteJobProgress) {
  return NextResponse.json({ data: body, error: null });
}

/**
 * POST /api/youtube/notes/continue — process EXACTLY ONE chunk of a job.
 *
 * Body: { jobId }. The client calls this in a loop until `done`. Each call
 * reads the job, generates one markdown section, appends it, and commits the
 * new counters. The next chunk index is derived from the row
 * (completed_chunks + chunks_failed), so progress survives a reload, a crash,
 * or the app being killed outright — the client holds no generation state.
 *
 * The chunk that finishes the job also creates the note and fires a push.
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

  // SEPARATE tier from the shared 20/60s interactive budget. One long video is
  // dozens of these; on the shared budget it would block itself partway
  // through AND lock the user out of every other AI feature for a minute.
  const rateLimit = checkYoutubeContinueRateLimit(user.id);
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
    return fail("JOB_NOT_FOUND", "Invalid JSON body", 400);
  }
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  if (!jobId) return fail("JOB_NOT_FOUND", "No job id was provided", 400);

  const { data: job } = await supabase
    .from("youtube_note_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  // RLS already hides other users' rows, so this is normally unreachable. It
  // is here anyway: the ownership boundary should be legible in the handler
  // and hold even if this route ever moves to the admin client, and a policy
  // regression should fail closed rather than leak someone else's note.
  if (!job || job.user_id !== user.id) {
    return fail("JOB_NOT_FOUND", "That note job could not be found", 404);
  }

  if (job.status === "failed") {
    return fail("GROQ_ERROR", job.error_message ?? "This note job failed", 502);
  }

  // Already finished: answer from the row without touching Groq. A client that
  // keeps polling a completed job costs nothing.
  if (job.status === "completed") {
    const note = await findNoteForJob(supabase, job);
    return ok(progressOf(job, { done: true, ...(note ? { note } : {}) }));
  }

  const index = nextChunkIndex(job);
  if (index >= job.total_chunks) {
    // Counters already say every chunk was processed but the job never
    // finalised — a crash between the last increment and the note insert.
    return finalize(supabase, job);
  }

  let chunks: string[];
  try {
    chunks = await loadJobChunks(job);
  } catch (err) {
    if (err instanceof TranscriptChangedError) {
      console.error("YouTube note job transcript changed:", err.message);
      const message =
        "The video's captions changed while this note was being written";
      await markFailed(supabase, job, message);
      return fail("TRANSCRIPT_CHANGED", message, 409);
    }
    if (err instanceof YoutubeExtractError) {
      // Assumed transient — the job is left alive so the next poll retries.
      // Nothing has been consumed.
      return fail(
        err.code,
        err.message,
        err.code === "PRIVATE_VIDEO" ? 404 : 502
      );
    }
    console.error("YouTube note job chunk load failed:", err);
    return fail("NETWORK_ERROR", "Couldn't read this video's transcript", 502);
  }

  // Mark the job in-flight on the first chunk so a resume banner can tell
  // "queued" from "running". Best-effort: a failure here changes nothing.
  if (job.status === "pending") {
    await supabase
      .from("youtube_note_jobs")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("user_id", user.id);
  }

  let section = "";
  let failedThisChunk = false;
  try {
    const generated = await generateNotesFromTranscript(
      job.video_title ?? "YouTube Notes",
      chunks[index]
    );
    section = generated.trim();
  } catch (err) {
    if (err instanceof EmptyGenerationError) {
      // The model read the chunk and found nothing worth writing (an intro, a
      // sponsor read, silence). No section, but nothing broke — counting it as
      // a failure would tell the user to retry for content that isn't there.
      console.warn("YouTube chunk had nothing to summarise:", err.message);
    } else {
      failedThisChunk = true;
      console.error("YouTube note generation failed for a chunk:", err);
    }
  }

  const nextCompleted = job.completed_chunks + (failedThisChunk ? 0 : 1);
  const nextFailed = job.chunks_failed + (failedThisChunk ? 1 : 0);
  const nextContent = section
    ? appendSection(job.partial_content, section)
    : job.partial_content;

  // Optimistic concurrency: only commit if the counters are still what we read.
  // Two tabs resuming the same job would otherwise both write chunk N and the
  // note would carry a duplicated section. A loser discards its section (a
  // wasted Groq call, never corrupted output) and reports the current state.
  const { data: updated } = await supabase
    .from("youtube_note_jobs")
    .update({
      completed_chunks: nextCompleted,
      chunks_failed: nextFailed,
      partial_content: nextContent,
      status: "processing",
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("user_id", user.id)
    .eq("completed_chunks", job.completed_chunks)
    .eq("chunks_failed", job.chunks_failed)
    .select()
    .maybeSingle();

  if (!updated) {
    const { data: current } = await supabase
      .from("youtube_note_jobs")
      .select("*")
      .eq("id", job.id)
      .maybeSingle();
    if (!current || current.user_id !== user.id) {
      return fail("JOB_NOT_FOUND", "That note job could not be found", 404);
    }
    return ok(progressOf(current, { done: current.status === "completed" }));
  }

  if (nextChunkIndex(updated) >= updated.total_chunks) {
    return finalize(supabase, updated);
  }

  return ok(progressOf(updated, { done: false }));
}

type SupabaseServerClient = ReturnType<typeof createClient>;

/**
 * Every chunk is processed: write the note, close the job, ping the device.
 *
 * ORDER MATTERS. The note is inserted and the job marked completed BEFORE the
 * push is attempted, and the push result is ignored — a push failure must
 * never cost the user a note that has already been generated.
 */
async function finalize(supabase: SupabaseServerClient, job: YoutubeNoteJob) {
  const content = job.partial_content.trim();

  if (!content) {
    // Nothing survived: every chunk either failed or was empty. This is the
    // one case where the whole job is a failure rather than a partial result.
    const message = "Note generation failed for this video";
    await markFailed(supabase, job, message);
    return fail("GROQ_ERROR", message, 502);
  }

  const videoTitle = job.video_title ?? "YouTube Notes";
  const { data: note, error: insertError } = await supabase
    .from("notes")
    .insert({
      user_id: job.user_id,
      title: videoTitle,
      content,
      tags: ["youtube-import"],
      // Without this the row lands with kind NULL, which is the "legacy,
      // pre-capture-kinds note" state — it never matches the Revisit filter on
      // /dashboard/notes, never reaches the dashboard's Revisit section, and
      // gets no kind switcher in NoteModal (that control is gated on a
      // non-null kind). A note distilled from a video is precisely the thing
      // you want resurfaced to re-read, so it is born a Revisit.
      kind: "revisit",
    })
    .select()
    .single();

  if (insertError || !note) {
    console.error("YouTube note insert failed:", insertError);
    // The job is left unfinalised on purpose: its counters already say every
    // chunk is done, so the next poll re-enters finalize and retries the
    // insert without regenerating anything.
    return fail(
      "GROQ_ERROR",
      "The note was generated but couldn't be saved",
      500
    );
  }

  const { data: completed } = await supabase
    .from("youtube_note_jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .select()
    .maybeSingle();

  dropJobChunks(job.id);

  const chunksFailed = (completed ?? job).chunks_failed;
  // Awaited only so the serverless function stays alive long enough to send;
  // the result is deliberately ignored. sendPushToUser never throws.
  await sendPushToUser(job.user_id, {
    title: "Your YouTube note is ready",
    body:
      chunksFailed > 0
        ? `"${videoTitle}" is saved, but ${chunksFailed} section${
            chunksFailed === 1 ? "" : "s"
          } couldn't be generated.`
        : `"${videoTitle}" is saved in your notes.`,
    url: "/dashboard/notes",
  });

  return ok(progressOf(completed ?? job, { done: true, note }));
}

async function markFailed(
  supabase: SupabaseServerClient,
  job: YoutubeNoteJob,
  message: string
) {
  await supabase
    .from("youtube_note_jobs")
    .update({
      status: "failed",
      error_message: message,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  dropJobChunks(job.id);
}

/**
 * Resolve the note a completed job produced. The job row has no note_id, so
 * this matches on what the insert above guarantees: same owner, title equal to
 * the video title, tagged youtube-import. Re-importing the same video finds
 * the newest, which is the right one.
 */
async function findNoteForJob(
  supabase: SupabaseServerClient,
  job: YoutubeNoteJob
): Promise<Note | null> {
  const { data } = await supabase
    .from("notes")
    .select("*")
    .eq("user_id", job.user_id)
    .eq("title", job.video_title ?? "YouTube Notes")
    .contains("tags", ["youtube-import"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}
