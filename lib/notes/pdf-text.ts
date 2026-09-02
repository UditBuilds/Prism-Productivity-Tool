/**
 * Make arbitrary note text safe to hand to @react-pdf/renderer.
 *
 * THE FAILURE THIS PREVENTS IS NOT COSMETIC. If a codepoint is present in no
 * font of the stack, react-pdf does not draw a blank or a .notdef box — it
 * throws `Offset is outside the bounds of the DataView` and the entire export
 * fails. Measured on the live notes table, five characters did exactly that,
 * and the longest real note in the account (37,772 chars) could not be
 * exported at all until this pass existed.
 *
 * Two layers, in order:
 *
 *  1. `SUBSTITUTIONS` — characters with a genuinely equivalent covered form.
 *     These are lossless in meaning: a non-breaking hyphen is a hyphen, a
 *     narrow no-break space is a space. This is where a newly-discovered
 *     offender should be added.
 *
 *  2. The coverage net — anything still outside `pdf-font-coverage.json` is
 *     dropped. That file is GENERATED FROM THE FONT FILES THEMSELVES by
 *     `scripts/build-pdf-font-coverage.mjs`, so it cannot drift from what the
 *     renderer can actually draw. On today's corpus this layer fires zero
 *     times; it exists so that a pasted emoji or a line of Chinese degrades to
 *     missing characters instead of taking down the whole export.
 */
import coverage from "./pdf-font-coverage.json";

/**
 * Codepoints no vendored face can draw, mapped to ones they can.
 *
 * Every entry here was measured, not guessed - `U+2011` alone appears 136
 * times in the real notes, which is why "export the long note" failed before
 * anything else did.
 */
const SUBSTITUTIONS: Record<string, string> = {
  // Written as \u escapes on purpose: half of these are invisible, and a
  // literal table of them is impossible to review or diff.
  "\u2010": "-", // HYPHEN
  "\u2011": "-", // NON-BREAKING HYPHEN - 136 occurrences in the live table
  "\u2027": "-", // HYPHENATION POINT
  "\u2007": " ", // FIGURE SPACE
  "\u2008": " ", // PUNCTUATION SPACE
  "\u2009": " ", // THIN SPACE
  "\u200A": " ", // HAIR SPACE
  "\u202F": " ", // NARROW NO-BREAK SPACE - 20 occurrences
  "\u205F": " ", // MEDIUM MATHEMATICAL SPACE
  "\u3000": " ", // IDEOGRAPHIC SPACE
  "\u200B": "", // ZERO WIDTH SPACE
  // The zero-width joiners carry meaning in Devanagari, but Noto Sans
  // Devanagari resolves conjuncts through its own GSUB tables, so dropping
  // them does not change the shaping react-pdf produces.
  "\u200C": "", // ZERO WIDTH NON-JOINER
  "\u200D": "", // ZERO WIDTH JOINER
  "\uFEFF": "", // ZERO WIDTH NO-BREAK SPACE / BOM
};

const RANGES = coverage.ranges as [number, number][];

/** Binary search the generated coverage ranges. */
function isCovered(cp: number): boolean {
  let lo = 0;
  let hi = RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = RANGES[mid];
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return true;
  }
  return false;
}

/**
 * Newlines and tabs never reach a glyph lookup — they are layout, and the
 * renderer consumes them before font resolution — so they must not be dropped
 * by the coverage net.
 */
function isLayoutChar(cp: number): boolean {
  return cp === 0x0a || cp === 0x0d || cp === 0x09;
}

/**
 * Returns the text with unsupported codepoints substituted or removed.
 *
 * Iterates by code POINT (`Array.from`, not `for (const c of s)` — tsconfig
 * has no `target`, so ES5 iteration semantics apply) so astral characters like
 * emoji are handled as single units rather than as surrogate halves.
 */
export function sanitizeForPdf(text: string): string {
  let out = "";
  let changed = false;

  for (const ch of Array.from(text)) {
    const sub = SUBSTITUTIONS[ch];
    if (sub !== undefined) {
      out += sub;
      changed = true;
      continue;
    }
    const cp = ch.codePointAt(0) ?? 0;
    if (isLayoutChar(cp) || isCovered(cp)) {
      out += ch;
      continue;
    }
    // Unrenderable and no equivalent: drop it. A run of "?" would be as
    // unreadable as the gap and noisier.
    changed = true;
  }

  return changed ? out : text;
}

/**
 * Which codepoints in `text` the fonts cannot draw and this module has no
 * substitution for. Used by the export test to assert the net is not silently
 * eating real content.
 */
export function unsupportedCodepoints(text: string): number[] {
  const found = new Set<number>();
  for (const ch of Array.from(text)) {
    if (SUBSTITUTIONS[ch] !== undefined) continue;
    const cp = ch.codePointAt(0) ?? 0;
    if (!isLayoutChar(cp) && !isCovered(cp)) found.add(cp);
  }
  // Array.from, not a spread: tsconfig sets no `target`, so ES5 iteration
  // semantics apply and spreading a Set is a compile error here.
  return Array.from(found).sort((a, b) => a - b);
}
