import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { generateFlashcardsFromTranscript } from "@/lib/ai/client";
import { mergeCards } from "@/lib/pdf/merge-cards";
import type { GeneratedCard } from "@/lib/pdf/types";
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
  type YoutubeAnalyzeSuccess,
  type YoutubeErrorCode,
} from "@/lib/youtube/types";

// Transcript fetch + multi-chunk Groq calls need Node + time headroom.
export const runtime = "nodejs";
export const maxDuration = 60;

const CHUNK_CHARS = 8000;
// generateFlashcardsFromNote rejects content under 100 chars.
const MIN_TRANSCRIPT_CHARS = 100;
const PER_CHUNK_CAP = 15;

type SuccessBody = { data: YoutubeAnalyzeSuccess; error: null };
type ErrorBody = { data: null; error: YoutubeAnalyzeError };

function ok(data: YoutubeAnalyzeSuccess) {
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

// POST /api/youtube/analyze — { url, cardCount, deckName? } → cards in SRS.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
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

  const rawCount = typeof body.cardCount === "number" ? body.cardCount : NaN;
  const cardCount = Number.isFinite(rawCount)
    ? Math.min(20, Math.max(3, Math.round(rawCount)))
    : 8;

  const providedDeck =
    typeof body.deckName === "string" && body.deckName.trim()
      ? body.deckName.trim()
      : null;

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
        "The transcript was too short to generate cards from",
        422
      );
    }

    const chunks = chunkTranscript(text, CHUNK_CHARS);

    // One chunk → ask for the full count; many → split evenly (+2 slack/chunk
    // so dedup still leaves enough), then mergeCards trims to cardCount.
    const perChunkTarget =
      chunks.length === 1
        ? cardCount
        : Math.min(
            PER_CHUNK_CAP,
            Math.max(3, Math.ceil(cardCount / chunks.length) + 2)
          );

    const perChunk: GeneratedCard[][] = [];
    for (const chunk of chunks) {
      try {
        // Sequential on purpose: bounded Groq rate-limit pressure.
        const cards = await generateFlashcardsFromTranscript(
          videoTitle,
          chunk,
          perChunkTarget
        );
        perChunk.push(cards);
      } catch (err) {
        console.error("YouTube chunk generation failed:", err);
      }
    }

    if (perChunk.length === 0) {
      return fail("GROQ_ERROR", "Card generation failed for this video", 502);
    }

    const merged = mergeCards(perChunk, cardCount);
    if (merged.length === 0) {
      return fail("GROQ_ERROR", "No usable cards came back from generation", 502);
    }

    // Insert directly into srs_cards — same row shape as the /api/srs/cards
    // bulk path; DB defaults supply the SM-2 fields (interval_days 1,
    // ease_factor 2.5, repetitions 0, next_review now() → due immediately).
    const deckName = providedDeck ?? videoTitle; // videoTitle already falls back to "YouTube Notes"
    const rows = merged.map((c) => ({
      user_id: user.id,
      front: c.front,
      back: c.back,
      deck_name: deckName,
      note_id: null,
    }));

    const { error: insertError } = await supabase.from("srs_cards").insert(rows);
    if (insertError) {
      console.error("YouTube card insert failed:", insertError);
      return fail("GROQ_ERROR", "Cards were generated but couldn't be saved", 500);
    }

    const data: YoutubeAnalyzeSuccess = {
      cards: merged,
      videoId,
      videoTitle,
      transcriptLength: text.length,
    };
    return ok(data);
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
    console.error("YouTube analyze error:", err);
    return fail("NETWORK_ERROR", "Something went wrong analyzing this video", 500);
  }
}
