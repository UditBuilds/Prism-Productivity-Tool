// Pure text-chunking helpers for the PDF pipeline.

export interface ChunkResult {
  /** Chunks selected for AI generation (bounded by maxChunks). */
  chunks: string[];
  /** True when the document produced more chunks than we could process. */
  sampled: boolean;
  /** How many chunks the full text would have produced. */
  totalCandidates: number;
}

/**
 * Split text into chunks of ~chunkSize chars, breaking at sentence boundaries
 * so chunks stay coherent. If the text yields more than maxChunks, sample
 * evenly across the document (always including the first chunk) instead of
 * just truncating the head — that's what makes Smart mode "smart".
 */
export function chunkText(
  text: string,
  chunkSize: number,
  maxChunks: number
): ChunkResult {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length === 0) {
    return { chunks: [], sampled: false, totalCandidates: 0 };
  }

  // Sentence-ish segments; fall back to hard slices for pathological text
  // (no punctuation) so a single "sentence" can't blow past the chunk size.
  const segments: string[] = [];
  for (const part of clean.split(/(?<=[.!?])\s+/)) {
    if (part.length <= chunkSize) {
      segments.push(part);
    } else {
      for (let i = 0; i < part.length; i += chunkSize) {
        segments.push(part.slice(i, i + chunkSize));
      }
    }
  }

  const all: string[] = [];
  let current = "";
  for (const segment of segments) {
    if (current.length + segment.length + 1 > chunkSize && current.length > 0) {
      all.push(current);
      current = segment;
    } else {
      current = current ? `${current} ${segment}` : segment;
    }
  }
  if (current.length > 0) all.push(current);

  if (all.length <= maxChunks) {
    return { chunks: all, sampled: false, totalCandidates: all.length };
  }

  // Evenly sample maxChunks indices across [0, all.length - 1].
  const picked: number[] = [];
  for (let i = 0; i < maxChunks; i++) {
    const idx = Math.round((i * (all.length - 1)) / (maxChunks - 1));
    if (!picked.includes(idx)) picked.push(idx);
  }
  return {
    chunks: picked.map((i) => all[i]),
    sampled: true,
    totalCandidates: all.length,
  };
}
