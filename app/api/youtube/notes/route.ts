import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { generateNotesFromTranscript } from "@/lib/ai/client";
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

interface YoutubeNotesSuccess {
  note: Note;
  videoId: string;
  videoTitle: string;
}

type SuccessBody = { data: YoutubeNotesSuccess; error: null };
type ErrorBody = { data: null; error: YoutubeAnalyzeError };

function ok(data: YoutubeNotesSuccess) {
  return NextResponse.json({ data, error: null } satisfies SuccessBody, {
    status: 200,
  });
}

function fail(code: YoutubeErrorCode, message: string, status: number) {
  const body: ErrorBody = {
    data: null,
    error: { code, message, hint: YOUTUBE_ERROR_HINTS[code] },
  };
  return NextResponse.json(body, { status });
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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return fail("INVALID_URL", "Invalid JSON body", 400);
  }

  const url = typeof body.url === "string" ? body.url : "";
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
    for (const chunk of chunks) {
      try {
        const section = await generateNotesFromTranscript(videoTitle, chunk);
        const trimmed = section.trim();
        if (trimmed) sections.push(trimmed);
      } catch (err) {
        console.error("YouTube note generation failed for a chunk:", err);
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

    return ok({ note, videoId, videoTitle });
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
