import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { extractVideoId } from "@/lib/youtube/extract";
import { MAX_URL_CHARS } from "@/lib/youtube/job";
import type { YoutubeNoteJobSummary } from "@/lib/youtube/types";
import type { YoutubeNoteJob } from "@/types/database";

export const runtime = "nodejs";

/**
 * GET /api/youtube/notes/job — the resume lookup behind the modal's banner.
 *
 * Read-only, no Groq call, so it is on no rate-limit tier. Two modes:
 *
 *   no query        → the caller's most recent UNFINISHED job, any video. This
 *                     is what the modal asks on open: "did I leave something
 *                     half-written before the app was killed?"
 *   ?url= / ?videoId= → the most recent job for THAT video in ANY status, so a
 *                     completed one can offer "View saved note" instead of
 *                     silently regenerating a note the user already has.
 *
 * Returns `{ data: { job: null } }` when there is nothing — an absent job is a
 * normal answer, not a 404.
 */
export async function GET(request: Request) {
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

  const params = new URL(request.url).searchParams;
  const rawUrl = params.get("url") ?? "";
  const videoId =
    params.get("videoId") ??
    (rawUrl.length <= MAX_URL_CHARS ? extractVideoId(rawUrl) : null);

  let query = supabase
    .from("youtube_note_jobs")
    .select("*")
    // Redundant with RLS; kept so the ownership boundary is visible here too.
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1);

  query = videoId
    ? query.eq("video_id", videoId)
    : query.in("status", ["pending", "processing"]);

  const { data: job, error } = await query.maybeSingle();
  if (error) {
    console.error("YouTube note job lookup failed:", error);
    return NextResponse.json(
      { data: { job: null }, error: null },
      { status: 200 }
    );
  }
  if (!job) {
    return NextResponse.json({ data: { job: null }, error: null });
  }

  return NextResponse.json({
    data: {
      job: {
        jobId: job.id,
        videoId: job.video_id,
        videoUrl: job.video_url,
        videoTitle: job.video_title ?? "YouTube Notes",
        status: job.status,
        completedChunks: job.completed_chunks,
        chunksFailed: job.chunks_failed,
        totalChunks: job.total_chunks,
        noteId:
          job.status === "completed" ? await resolveNoteId(supabase, job) : null,
      } satisfies YoutubeNoteJobSummary,
    },
    error: null,
  });
}

/**
 * Same resolution rule as /continue: the job row carries no note_id, so the
 * note is found by what the insert guarantees — same owner, title equal to the
 * video title, tagged youtube-import, newest first.
 */
async function resolveNoteId(
  supabase: ReturnType<typeof createClient>,
  job: YoutubeNoteJob
): Promise<string | null> {
  const { data } = await supabase
    .from("notes")
    .select("id")
    .eq("user_id", job.user_id)
    .eq("title", job.video_title ?? "YouTube Notes")
    .contains("tags", ["youtube-import"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}
