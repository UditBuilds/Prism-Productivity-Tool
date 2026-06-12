// Merge + dedupe flashcards generated from multiple chunks of one document.
import type { GeneratedCard } from "./types";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Question scaffolding ("what is the…", "explain…") appears in nearly every
// card — compare only content words, or different cards look like duplicates.
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "what",
  "which", "who", "how", "why", "when", "where", "does", "did", "do",
  "its", "this", "that", "these", "those", "with", "from", "for", "and",
  "not", "can", "into", "between", "of", "in", "on", "to", "explain",
  "define", "describe", "name", "list", "main", "term",
]);

function tokenSet(s: string): Set<string> {
  // Numbers count toward distinctness ("stage 1" vs "stage 2" questions).
  return new Set(
    normalize(s)
      .split(" ")
      .filter(
        (t) => (t.length > 2 || /^\d+$/.test(t)) && !STOPWORDS.has(t)
      )
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of Array.from(a)) {
    if (b.has(t)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

/** Two cards are near-duplicates when their questions substantially overlap. */
function isDuplicate(
  card: GeneratedCard,
  kept: { norm: string; tokens: Set<string> }[]
): boolean {
  const norm = normalize(card.front);
  const tokens = tokenSet(card.front);
  return kept.some(
    (k) => k.norm === norm || jaccard(k.tokens, tokens) > 0.75
  );
}

/**
 * Interleave cards round-robin across chunks (so the final set covers the
 * whole analyzed span instead of exhausting chunk 1 first), dropping
 * near-duplicates, and trim to the requested count.
 */
export function mergeCards(
  perChunk: GeneratedCard[][],
  target: number
): GeneratedCard[] {
  const merged: GeneratedCard[] = [];
  const kept: { norm: string; tokens: Set<string> }[] = [];
  const maxLen = Math.max(0, ...perChunk.map((c) => c.length));

  for (let round = 0; round < maxLen && merged.length < target; round++) {
    for (const chunk of perChunk) {
      if (merged.length >= target) break;
      const card = chunk[round];
      if (!card) continue;
      if (isDuplicate(card, kept)) continue;
      merged.push(card);
      kept.push({ norm: normalize(card.front), tokens: tokenSet(card.front) });
    }
  }
  return merged;
}
