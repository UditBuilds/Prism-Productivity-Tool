// SERVER-ONLY: per-page text extraction on top of pdf-parse@1.1.1.
// pdf-parse renders pages sequentially through `pagerender`, so a closure
// collecting each page's text gives us honest page-level extraction — which is
// what makes Quick / Smart / Custom Range modes real rather than cosmetic.
import pdf from "pdf-parse";

interface PdfTextItem {
  str?: string;
}
interface PdfTextContent {
  items: PdfTextItem[];
}
interface PdfPageData {
  getTextContent(options?: {
    normalizeWhitespace?: boolean;
    disableCombineTextItems?: boolean;
  }): Promise<PdfTextContent>;
}

export interface ExtractedPdf {
  /** Total pages in the document (even beyond what we parsed). */
  pageCount: number;
  /** Pages actually rendered (bounded by maxPages). */
  pagesParsed: number;
  /** Whitespace-normalized text per parsed page; index 0 = page 1. */
  pages: string[];
}

/**
 * Extract text for the first `maxPages` pages. `pageCount` still reflects the
 * full document, so callers can report honest totals and validate ranges.
 */
export async function extractPages(
  buffer: Buffer,
  maxPages: number
): Promise<ExtractedPdf> {
  const pages: string[] = [];

  const renderPage = async (pageData: PdfPageData): Promise<string> => {
    const content = await pageData.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    const text = content.items
      .map((item) => item.str ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push(text);
    return text;
  };

  const result = await pdf(buffer, {
    max: maxPages,
    // @types/pdf-parse types pagerender as returning string; the library
    // awaits the return value, so an async renderer is correct at runtime.
    pagerender: renderPage as unknown as (pageData: unknown) => string,
  });

  return {
    pageCount: result.numpages,
    pagesParsed: pages.length,
    pages,
  };
}
