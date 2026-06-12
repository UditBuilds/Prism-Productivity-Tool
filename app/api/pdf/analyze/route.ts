import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { generateFlashcardsFromNote } from "@/lib/ai/client";
import { extractPages } from "@/lib/pdf/extract";
import { chunkText } from "@/lib/pdf/chunk";
import { mergeCards } from "@/lib/pdf/merge-cards";
import { PdfAnalyzeError } from "@/lib/pdf/errors";
import {
  PDF_BUCKET,
  PDF_MAX_BYTES,
  RANGE_MAX_PAGES,
  type AnalyzeData,
  type AnalyzeMode,
  type GeneratedCard,
} from "@/lib/pdf/types";

// pdf-parse needs the Node runtime; multi-chunk Groq calls need time headroom.
export const runtime = "nodejs";
export const maxDuration = 60;

// Extraction budgets (serverless-realistic, documented in the UI copy).
const QUICK_MAX_PAGES = 30;
const QUICK_TARGET_CHARS = 14000;
const SMART_MAX_PAGES = 200;
const CHUNK_SIZE = 9000;
const MAX_CHUNKS: Record<AnalyzeMode, number> = {
  quick: 1,
  smart: 4,
  range: 3,
};
// Below this much total text the result would be junk.
const MIN_TOTAL_CHARS = 250;
// Under ~15 chars/page across parsed pages → almost certainly image-only.
const SCANNED_AVG_CHARS_PER_PAGE = 15;
const RESPONSE_TEXT_CAP = 40000;

type ApiResponse<T> = { data: T | null; error: string | null; code?: string };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

const MODES: AnalyzeMode[] = ["quick", "smart", "range"];

function isMode(v: unknown): v is AnalyzeMode {
  return typeof v === "string" && MODES.includes(v as AnalyzeMode);
}

function parseIntInRange(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? Math.round(v) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

// POST /api/pdf/analyze — analyze a stored PDF and draft flashcards from it.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ data: null, error: "Invalid JSON body" }, 400);
  }

  // --- Validate request shape -------------------------------------------
  const path = typeof body.path === "string" ? body.path : "";
  if (
    !path ||
    !path.startsWith(`${user.id}/`) ||
    path.includes("..") ||
    !path.toLowerCase().endsWith(".pdf")
  ) {
    return json(
      { data: null, error: "Invalid file path", code: "STORAGE_FAILED" },
      400
    );
  }

  const filename =
    typeof body.filename === "string" && body.filename.trim()
      ? body.filename.trim()
      : "document.pdf";

  const mode: AnalyzeMode = isMode(body.mode) ? body.mode : "quick";

  const rawCount =
    typeof body.cardCount === "number" ? body.cardCount : NaN;
  const cardCount = Number.isFinite(rawCount)
    ? Math.min(30, Math.max(5, Math.round(rawCount)))
    : 10;

  let pageStart = 1;
  let pageEnd = 0;

  // Everything past this point runs inside try/finally so the uploaded temp
  // object is always cleaned up — including validation failures.
  try {
    if (mode === "range") {
      const start = parseIntInRange(body.pageStart, 1, 5000);
      const end = parseIntInRange(body.pageEnd, 1, 5000);
      if (!start || !end || end < start) {
        throw new PdfAnalyzeError("INVALID_RANGE", "Invalid page range", 400);
      }
      if (end - start + 1 > RANGE_MAX_PAGES) {
        throw new PdfAnalyzeError(
          "INVALID_RANGE",
          `Page range is too large — max ${RANGE_MAX_PAGES} pages per analysis`,
          400
        );
      }
      pageStart = start;
      pageEnd = end;
    }
    // --- Fetch bytes from private storage (never through the request body) --
    const { data: blob, error: downloadError } = await supabase.storage
      .from(PDF_BUCKET)
      .download(path);

    if (downloadError || !blob) {
      throw new PdfAnalyzeError(
        "STORAGE_FAILED",
        "Couldn't read the uploaded file from storage",
        404
      );
    }
    if (blob.size > PDF_MAX_BYTES) {
      throw new PdfAnalyzeError(
        "FILE_TOO_LARGE",
        "PDF too large (max 25 MB)",
        400
      );
    }

    const buffer = Buffer.from(await blob.arrayBuffer());

    // --- Extract per-page text, bounded by mode ---------------------------
    const maxPages =
      mode === "quick"
        ? QUICK_MAX_PAGES
        : mode === "smart"
          ? SMART_MAX_PAGES
          : pageEnd;

    let extracted;
    try {
      extracted = await extractPages(buffer, maxPages);
    } catch {
      throw new PdfAnalyzeError(
        "EXTRACT_FAILED",
        "Couldn't extract text from this PDF",
        500
      );
    }

    const { pageCount, pages } = extracted;

    // --- Select the pages each mode actually uses -------------------------
    let usedPages: string[];
    if (mode === "range") {
      if (pageStart > pageCount) {
        throw new PdfAnalyzeError(
          "INVALID_RANGE",
          `This document only has ${pageCount} page${pageCount === 1 ? "" : "s"}`,
          400
        );
      }
      usedPages = pages.slice(pageStart - 1, pageEnd);
    } else if (mode === "quick") {
      usedPages = [];
      let chars = 0;
      for (const page of pages) {
        usedPages.push(page);
        chars += page.length;
        if (chars >= QUICK_TARGET_CHARS) break;
      }
    } else {
      usedPages = pages;
    }

    const text = usedPages.join("\n").replace(/\s+/g, " ").trim();
    const totalChars = text.length;

    // --- Honest failure taxonomy ------------------------------------------
    if (totalChars < MIN_TOTAL_CHARS) {
      const parsedPageCount = Math.max(1, usedPages.length);
      const avg = totalChars / parsedPageCount;
      if (avg < SCANNED_AVG_CHARS_PER_PAGE && pageCount > 0) {
        throw new PdfAnalyzeError(
          "SCANNED_PDF",
          "Almost no selectable text found — this PDF appears to be scanned images",
          422
        );
      }
      throw new PdfAnalyzeError(
        "TOO_LITTLE_TEXT",
        "Not enough text to generate meaningful cards from this selection",
        422
      );
    }

    // --- Chunk + generate + merge ------------------------------------------
    const { chunks, sampled } = chunkText(text, CHUNK_SIZE, MAX_CHUNKS[mode]);
    // The doc had more parsed text than the chunks carry → coverage was sampled.
    const wasSampled =
      sampled || (mode === "quick" && pages.length < pageCount);

    const title = filename.replace(/\.pdf$/i, "");
    const perChunkTarget = Math.min(
      15,
      Math.max(
        3,
        Math.ceil(cardCount / chunks.length) + (chunks.length > 1 ? 2 : 0)
      )
    );

    const perChunkCards: GeneratedCard[][] = [];
    for (const chunk of chunks) {
      try {
        // Sequential on purpose: bounded Groq rate-limit pressure.
        const cards = await generateFlashcardsFromNote(
          title,
          chunk,
          perChunkTarget
        );
        perChunkCards.push(cards);
      } catch (err) {
        console.error("PDF chunk generation failed:", err);
      }
    }

    if (perChunkCards.length === 0) {
      throw new PdfAnalyzeError(
        "AI_FAILED",
        "Card generation failed for this document",
        502
      );
    }

    const merged = mergeCards(perChunkCards, cardCount);
    if (merged.length === 0) {
      throw new PdfAnalyzeError(
        "AI_FAILED",
        "No usable cards came back from generation",
        502
      );
    }

    const data: AnalyzeData = {
      cards: merged,
      extractedText: chunks.join("\n\n").slice(0, RESPONSE_TEXT_CAP),
      filename,
      pageCount,
      pagesUsed: usedPages.length,
      mode,
      chunkCount: chunks.length,
      sampled: wasSampled,
      totalChars,
    };
    return json<AnalyzeData>({ data, error: null });
  } catch (err) {
    if (err instanceof PdfAnalyzeError) {
      return json({ data: null, error: err.message, code: err.code }, err.status);
    }
    console.error("PDF analyze error:", err);
    return json(
      {
        data: null,
        error: "Failed to analyze the PDF",
        code: "EXTRACT_FAILED",
      },
      500
    );
  } finally {
    // Temp object cleanup — the PDF has served its purpose either way.
    // (supabase remove doesn't throw; ignore its error result.)
    await supabase.storage.from(PDF_BUCKET).remove([path]);
  }
}
