import type { PdfErrorCode } from "./types";

/** Typed pipeline error — the route maps it to { error, code } + HTTP status. */
export class PdfAnalyzeError extends Error {
  constructor(
    public readonly code: PdfErrorCode,
    message: string,
    public readonly status: number = 400
  ) {
    super(message);
    this.name = "PdfAnalyzeError";
  }
}
