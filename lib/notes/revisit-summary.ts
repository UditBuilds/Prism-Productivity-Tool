/**
 * What the dashboard's Revisit widget is allowed to show, and how much of a
 * note goes to the model when a summary has to be made.
 *
 * Pure, dependency-free (beyond markdownExcerpt), and unit-tested via
 * scripts/test-revisit-summary.mjs. Both the API route and the row component
 * import from here so the threshold cannot drift between the code that WRITES
 * a summary and the code that DECIDES whether to show one.
 */
import { markdownExcerpt } from "@/lib/markdown";

/**
 * Above this many characters a Revisit note gets an AI summary; at or below
 * it the widget renders the raw content and NO AI call is ever made.
 *
 * 600 is roughly what fits in a dashboard row before the section starts to
 * dominate the page. Measured against the live table: every one of the 13
 * Revisit notes is over it (smallest 1,886 chars, largest 114,787), so the
 * threshold is not currently doing any excluding — it exists so that a short
 * hand-written Revisit note never costs a Groq call to say what it already
 * says in two lines.
 */
export const SUMMARY_THRESHOLD_CHARS = 600;

/**
 * The stopgap when `summary` is null on a long note — a plain-text excerpt,
 * never a live AI call. This is the SAME helper the Notes tab list uses for
 * its card previews (markdownExcerpt), at a slightly shorter cap because a
 * dashboard row is tighter than a note card.
 *
 * A summary is generated on save and by the backfill, so this is reached only
 * in genuinely transient states: a note whose summary generation failed, or a
 * row created by a path that doesn't summarize yet (the YouTube job's
 * finalize insert). Rendering something is always right; blocking a server
 * component on Groq would not be.
 */
export const FALLBACK_EXCERPT_CHARS = 220;

/** True when this content is long enough to warrant a generated summary. */
export function needsSummary(content: string | null | undefined): boolean {
  return (content ?? "").length > SUMMARY_THRESHOLD_CHARS;
}

/**
 * What the Revisit row should actually render, as a discriminated result.
 *
 *   "raw"      — short note: the markdown itself, current behaviour, unchanged.
 *   "summary"  — long note with a cached summary: render that markdown.
 *   "fallback" — long note, no summary yet: a truncated plain-text excerpt.
 *   "empty"    — nothing to show.
 *
 * Returning the DECISION rather than a string keeps the component free to
 * render markdown for two of the branches and plain text for the third, which
 * is the actual difference between them.
 */
export type RevisitPreview =
  | { mode: "empty" }
  | { mode: "raw"; markdown: string }
  | { mode: "summary"; markdown: string }
  | { mode: "fallback"; text: string };

export function revisitPreview(
  content: string | null | undefined,
  summary: string | null | undefined
): RevisitPreview {
  const body = content ?? "";
  if (!body.trim()) return { mode: "empty" };

  if (!needsSummary(body)) return { mode: "raw", markdown: body };

  const cached = (summary ?? "").trim();
  if (cached) return { mode: "summary", markdown: cached };

  const text = markdownExcerpt(body, FALLBACK_EXCERPT_CHARS);
  return text ? { mode: "fallback", text } : { mode: "empty" };
}

/**
 * How much of a note is sent to the model, and in what shape.
 *
 * NOT a plain `content.slice(...)`, and the reason is the account's budget
 * rather than taste. Groq reserves `prompt_tokens + max_tokens` up front on an
 * 8,000 TPM account, so lib/ai/client.ts's general MAX_SOURCE_CHARS of 32,000
 * (~8k tokens) would be REFUSED before the model ran. Summarization therefore
 * gets its own much smaller budget — and inside that budget, a leading slice
 * of a 114,787-character note would show the model the first 4% of it and
 * nothing else, producing a summary of the introduction rather than of the
 * note.
 *
 * So the digest is: the opening prose (which states what the note is about)
 * followed by the heading outline (which states what it covers). These notes
 * are YouTube-import markdown and are densely headed — the largest carries 238
 * `##` headings — so the outline buys document-wide coverage for a few hundred
 * tokens. A note with no headings simply contributes more prose.
 *
 * WHEN THERE ARE MORE HEADINGS THAN FIT, THEY ARE SAMPLED EVENLY, NOT CUT OFF.
 * This is the whole point of the outline and it is easy to get wrong. Taking
 * the FIRST 70 of 238 was measured on the real 114,787-char note: the outline
 * stopped about 30% in, so the digest saw the note's opening and its first
 * third and was blind to the rest — the same failure a leading slice has, just
 * further down. An even stride keeps the first and last headings and spreads
 * the rest across everything between, at identical token cost.
 */
/**
 * Hard ceiling on a STORED summary, enforced in code rather than asked for.
 *
 * The prompt states the length rule twice and the model still misses it: the
 * real notes came back at 236-503 characters, and tightening the wording to
 * "never exceed 340" only moved the worst case from 503 to 475. LLMs do not
 * count characters reliably, so a length contract expressed only in a prompt
 * is a wish. This is the contract.
 *
 * WHY 340 AND NOT THE SPEC'S 300. 300 is the TARGET the prompt asks for; 340
 * is the backstop that catches genuine overshoot without trimming summaries
 * that landed essentially on target. Measured against the finished corpus of
 * 13 real rows (236, 261, 269, 284, 289, 297, 298, 302, 304, 312, 313, 313,
 * 338): a 340 ceiling fires on ZERO of them, a 300 ceiling would fire on SIX
 * — dropping a bullet from summaries that missed the target by 2-13
 * characters, which costs real content to buy nothing. It is also the same
 * number the prompt states as its hard ceiling, so prompt and clamp agree on
 * one figure rather than disagreeing on two.
 *
 * NOT derived from a measured row height. Nothing in this arc was rendered at
 * 375x812 — the dashboard is behind a login the agent could not pass — so
 * whether 340 is the right number FOR THE ROW is still unverified. It is
 * chosen against the spec target and the observed distribution, nothing more.
 */
export const SUMMARY_MAX_CHARS = 340;

/**
 * Trim a generated summary to SUMMARY_MAX_CHARS by DROPPING WHOLE BULLETS,
 * never by cutting text mid-word.
 *
 * A summary is the stand-in for a note the reader cannot see, so a bullet
 * ending "...deploy on Cloudfl" is worse than one fewer bullet: the first
 * looks like a rendering bug and the second just says less. Bullets come out
 * of the model roughly in importance order, so the ones dropped are the ones
 * that matter least.
 *
 * THE TWO-BULLET FLOOR BEATS THE 340 CEILING, and the output can therefore
 * exceed SUMMARY_MAX_CHARS. This is the one place the two rules conflict, so
 * it is stated rather than left to be discovered. Measured, not reasoned:
 *
 *   one 401-char bullet    -> 401 chars, returned byte-identical, 1 line
 *   two 401-char bullets   -> 803 chars, both kept, 2 lines
 *   three 401-char bullets -> 803 chars, first two kept, third dropped
 *
 * A single bullet is a headline, not a summary, so the floor is the rule that
 * gives way last. The overshoot stays bounded by the model's own per-bullet
 * length (the real corpus tops out at 338 for a WHOLE summary), which is
 * nothing like the unbounded raw note this feature exists to cap. "Never cuts
 * mid-word" holds in every one of those cases — the ceiling is what bends.
 *
 * The non-bullet fallback has no such floor and always lands within
 * SUMMARY_MAX_CHARS + 1 (the ellipsis). Its one degenerate case is text with
 * no space in the first 340 characters, where there is no word boundary to
 * trim at and it cuts mid-word by necessity; no model output has ever looked
 * like that, and the alternative would be returning nothing.
 */
export function clampSummary(raw: string): string {
  const text = raw.trim();
  if (text.length <= SUMMARY_MAX_CHARS) return text;

  const bullets = text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => /^\s*[-*]\s+\S/.test(l));

  // Not a bullet list at all (the model ignored the format). Fall back to a
  // word-boundary trim — still never mid-word.
  if (bullets.length === 0) {
    const cut = text.slice(0, SUMMARY_MAX_CHARS);
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
  }

  const kept: string[] = [];
  let total = 0;
  for (const b of bullets) {
    const next = total + b.length + (kept.length ? 1 : 0);
    if (kept.length >= 2 && next > SUMMARY_MAX_CHARS) break;
    kept.push(b);
    total = next;
  }
  return kept.join("\n");
}

export const SUMMARY_SOURCE_CHARS = 5000;
const OPENING_CHARS = 1600;
const MAX_OUTLINE_HEADINGS = 70;

/** Every heading in the note, emphasis marks stripped, in document order. */
function collectHeadings(body: string): string[] {
  const headings: string[] = [];
  for (const line of body.split("\n")) {
    const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (!m) continue;
    // The outline is a list of topics, not a place where **bold** earns tokens.
    const text = m[2].replace(/[*_`]/g, "").trim();
    if (text) headings.push(`${"#".repeat(Math.min(m[1].length, 3))} ${text}`);
  }
  return headings;
}

/** At most `max` entries, spread evenly, always keeping the first and last. */
function sampleEvenly(items: string[], max: number): string[] {
  if (items.length <= max) return items;
  const step = (items.length - 1) / (max - 1);
  const picked: string[] = [];
  for (let i = 0; i < max; i++) picked.push(items[Math.round(i * step)]);
  return picked;
}

export function buildSummarySource(content: string): string {
  const body = content.replace(/\r\n/g, "\n");

  const headings = sampleEvenly(collectHeadings(body), MAX_OUTLINE_HEADINGS);
  const opening = body.slice(0, OPENING_CHARS).trim();
  const outline = headings.join("\n");

  const digest = outline
    ? `${opening}\n\n--- Section outline ---\n${outline}`
    : opening || body.slice(0, SUMMARY_SOURCE_CHARS).trim();

  return digest.slice(0, SUMMARY_SOURCE_CHARS);
}
