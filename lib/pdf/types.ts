// Client-safe shared types for the PDF analyzer pipeline. No server imports.

export type AnalyzeMode = "quick" | "smart" | "range";

export type PdfErrorCode =
  | "FILE_TOO_LARGE"
  | "SCANNED_PDF"
  | "TOO_LITTLE_TEXT"
  | "INVALID_RANGE"
  | "EXTRACT_FAILED"
  | "AI_FAILED"
  | "STORAGE_FAILED";

export interface GeneratedCard {
  front: string;
  back: string;
}

export interface AnalyzeRequest {
  path: string;
  filename: string;
  mode: AnalyzeMode;
  cardCount: number;
  pageStart?: number;
  pageEnd?: number;
}

export interface AnalyzeData {
  cards: GeneratedCard[];
  /** The analyzed text (capped) — used when saving as a note. */
  extractedText: string;
  filename: string;
  /** Total pages in the document. */
  pageCount: number;
  /** Pages whose text actually fed the generation. */
  pagesUsed: number;
  mode: AnalyzeMode;
  /** Number of text chunks sent to the AI. */
  chunkCount: number;
  /** True when the document had more text than we analyzed (sampled). */
  sampled: boolean;
  totalChars: number;
}

/** Matches the Supabase bucket file_size_limit (25 MB). */
export const PDF_MAX_BYTES = 25 * 1024 * 1024;
export const PDF_BUCKET = "pdf-uploads";
/** Custom range cap — keeps extraction within serverless time budgets. */
export const RANGE_MAX_PAGES = 120;

export const MODE_INFO: Record<
  AnalyzeMode,
  { label: string; description: string }
> = {
  quick: {
    label: "Quick Extract",
    description: "Fastest — reads the first ~30 pages",
  },
  smart: {
    label: "Full Smart Extract",
    description: "Broader coverage — samples across the whole document",
  },
  range: {
    label: "Custom Page Range",
    description: "Analyze specific pages only",
  },
};

/** Human recovery hints per error code (shown under the error message). */
export const PDF_ERROR_HINTS: Record<PdfErrorCode, string> = {
  FILE_TOO_LARGE: "The limit is 25 MB. Try splitting the PDF first.",
  SCANNED_PDF:
    "This looks like a scanned/image-only PDF — Prism can't read those yet. Try a text-based export instead.",
  TOO_LITTLE_TEXT:
    "Try Full Smart Extract, a different page range, or a PDF with more text content.",
  INVALID_RANGE: "Check the page numbers and try again.",
  EXTRACT_FAILED:
    "The file may be corrupted or password-protected. Try re-exporting the PDF.",
  AI_FAILED: "The AI service hiccuped — this usually works on a retry.",
  STORAGE_FAILED: "Check your connection and try again.",
};
