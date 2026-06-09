import { NextResponse } from "next/server";
import pdf from "pdf-parse";

import { createClient } from "@/lib/supabase/server";
import { generateFlashcardsFromNote } from "@/lib/ai/client";

// pdf-parse needs the Node runtime (Buffer + Node APIs), not the edge runtime.
export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024; // 4MB
const MAX_CHARS = 6000; // Groq context safety
const MIN_CHARS = 100;

type GeneratedCard = { front: string; back: string };

interface AnalyzeData {
  cards: GeneratedCard[];
  extractedText: string;
  filename: string;
  pageCount: number;
  truncated: boolean;
}

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

// POST /api/pdf/analyze — extract a PDF's text and draft flashcards from it.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  // App Router parses multipart natively via formData().
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ data: null, error: "Invalid form data" }, 400);
  }

  const fileEntry = formData.get("file");
  if (!fileEntry || typeof fileEntry === "string") {
    return json({ data: null, error: "No file provided" }, 400);
  }
  const file = fileEntry;

  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return json({ data: null, error: "File must be a PDF" }, 400);

  if (file.size > MAX_BYTES) {
    return json({ data: null, error: "PDF too large (max 4MB)" }, 400);
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    const pdfData = await pdf(buffer);
    const rawText = pdfData.text ?? "";

    // Collapse whitespace, then cap length for the model.
    const collapsed = rawText.replace(/\s+/g, " ").trim();
    const cleanText = collapsed.slice(0, MAX_CHARS);
    const truncated = collapsed.length > MAX_CHARS;

    if (cleanText.length < MIN_CHARS) {
      return json(
        {
          data: null,
          error:
            "Could not extract enough text from this PDF. It may be a scanned image — only text-based PDFs are supported.",
        },
        400
      );
    }

    const filename = file.name;
    const title = filename.replace(/\.pdf$/i, "");
    const cards = await generateFlashcardsFromNote(title, cleanText);

    return json<AnalyzeData>({
      data: {
        cards,
        extractedText: cleanText,
        filename,
        pageCount: pdfData.numpages,
        truncated,
      },
      error: null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to analyze the PDF.";
    return json({ data: null, error: message }, 500);
  }
}
