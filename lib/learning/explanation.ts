import { LESSON_MAX_WORDS, LESSON_MIN_WORDS } from "@/lib/learning/constants";
import { splitSentences, wordCount, type SourceBlock } from "@/lib/learning/passages";

/**
 * The AI explanation (Udit, 2026-10-10, "source shown + AI explains"), its
 * shape rules, and the stored lesson body. Pure.
 *
 * The reader sees, in this order:
 *   1. the SOURCE: 1-3 passages from one page, word for word, and one code
 *      example from the same page exactly as written (passages.ts);
 *   2. the AI EXPLANATION, marked as written by AI as a whole: what the idea
 *      means, then the shown code line by line, then one closing line.
 * The writer answers in JSON (writer-prompt.ts): every sentence is its own
 * list item, so each one can be checked (code-rule.ts, judge.ts) and, at
 * most once, replaced on its own — nothing is cut out of prose with a regex.
 */

export interface Explanation {
  /** What the idea means: paragraphs, each a list of sentences. */
  meaning: { sentences: string[] }[];
  /** The shown code, one item per non-blank line, top to bottom. Empty when no code is shown. */
  walkthrough: { line: number; sentences: string[] }[];
  /** One sentence. */
  closing: string;
}

export interface Sentence {
  /** 1-based, reading order. What the checks and the fix turn refer to. */
  id: number;
  text: string;
  part: "meaning" | "walkthrough" | "closing";
  /** walkthrough: the code line it explains (1-based). */
  line: number | null;
}

/** Every sentence in reading order, numbered from 1. */
export function sentencesOf(e: Explanation): Sentence[] {
  const out: Sentence[] = [];
  for (const p of e.meaning) for (const text of p.sentences) out.push({ id: out.length + 1, text, part: "meaning", line: null });
  for (const w of e.walkthrough) for (const text of w.sentences) out.push({ id: out.length + 1, text, part: "walkthrough", line: w.line });
  out.push({ id: out.length + 1, text: e.closing, part: "closing", line: null });
  return out;
}

/**
 * The explanation with sentences replaced by id (sentencesOf numbering). An
 * empty replacement removes the sentence, and a paragraph left empty goes
 * with it; a walk-through item left empty stays, so the shape check reports
 * the code line it no longer explains. Returns the new explanation and the
 * ids, in ITS numbering, of the sentences that are new.
 */
export function withReplacements(e: Explanation, replacements: Map<number, string>): { explanation: Explanation; changed: number[] } {
  let id = 0;
  let newId = 0;
  const changed: number[] = [];
  const swap = (sentences: string[]) =>
    sentences.flatMap((text) => {
      id += 1;
      const r = replacements.get(id);
      if (r === undefined) {
        newId += 1;
        return [text];
      }
      if (!r.trim()) return [];
      newId += 1;
      changed.push(newId);
      return [r.trim()];
    });
  const meaning = e.meaning.map((p) => ({ sentences: swap(p.sentences) })).filter((p) => p.sentences.length > 0);
  const walkthrough = e.walkthrough.map((w) => ({ line: w.line, sentences: swap(w.sentences) }));
  const [closing] = swap([e.closing]);
  return { explanation: { meaning, walkthrough, closing: closing ?? "" }, changed };
}

/** Words that count toward 300-500: every sentence, the closing line included. */
export function explanationWords(e: Explanation): number {
  return sentencesOf(e).reduce((n, s) => n + wordCount(s.text), 0);
}

/**
 * One thing wrong with an explanation. `sentence` is the id of the sentence
 * at fault (the fix turn can resend it); null for a shape problem no single
 * sentence can mend.
 */
export interface Problem {
  sentence: number | null;
  /** "G1": the code rule (code-rule.ts). "G2": the meaning check (judge.ts). "links": a web address. "shape": these rules. */
  check: "G1" | "G2" | "links" | "shape";
  text: string;
  reason: string;
}

/** The code's non-blank line numbers (1-based): the lines the walk-through must explain. */
export function linesToWalk(code: string | null): number[] {
  if (code === null) return [];
  return code.split("\n").flatMap((l, i) => (l.trim() ? [i + 1] : []));
}

/**
 * The shape rules, all checked in code: what it means, then every non-blank
 * code line in order, then one closing sentence; 300-500 words.
 */
export function checkShape(e: Explanation, source: SourceBlock): Problem[] {
  const problems: Problem[] = [];
  const shape = (reason: string, text = "") => problems.push({ sentence: null, check: "shape", text, reason });

  if (!e.meaning.some((p) => p.sentences.some((s) => s.trim()))) shape("it says nothing about what the idea means");
  for (const s of sentencesOf(e)) {
    if (s.part !== "closing" && !s.text.trim()) shape(`sentence ${s.id} is empty`);
    if (s.text.includes("```")) problems.push({ sentence: s.id, check: "shape", text: s.text, reason: "a code block inside a sentence; the code is shown above, from the page" });
  }

  const want = linesToWalk(source.code);
  if (source.code === null) {
    if (e.walkthrough.length > 0) shape("it walks through code, but the lesson shows none");
  } else {
    const count = source.code.split("\n").length;
    let last = 0;
    const covered = new Set<number>();
    for (const w of e.walkthrough) {
      if (w.line < 1 || w.line > count) shape(`the walk-through explains line ${w.line}, but the code has lines 1 to ${count}`);
      else if (!want.includes(w.line)) shape(`the walk-through explains line ${w.line}, which is blank`);
      else if (w.line <= last) shape(`the walk-through goes back to line ${w.line} after line ${last}; it must go top to bottom, one item per line`);
      else covered.add(w.line);
      if (!w.sentences.some((s) => s.trim())) shape(`the walk-through item for line ${w.line} says nothing`);
      last = Math.max(last, w.line);
    }
    const missing = want.filter((n) => !covered.has(n));
    if (missing.length > 0) shape(`the walk-through skips code line${missing.length === 1 ? "" : "s"} ${missing.join(", ")}`);
  }

  if (!e.closing.trim()) shape("it has no closing line");
  else if (splitSentences(e.closing).length > 1) shape("the closing line is more than one sentence", e.closing);

  const words = explanationWords(e);
  if (words < LESSON_MIN_WORDS || words > LESSON_MAX_WORDS) shape(`it is ${words} words; it must be ${LESSON_MIN_WORDS} to ${LESSON_MAX_WORDS}`);
  return problems;
}

// ─── the stored body ──────────────────────────────────────────────────────

export const SOURCE_HEADING = "From the source, word for word";
export const AI_HEADING = "AI explanation";
/** Under AI_HEADING: the whole explanation is marked as AI, so no sentence carries its own mark. */
export const AI_NOTE = "Written by AI to explain the source above. It is not part of the page listed under Sources.";

/** A code line as inline code in the walk-through list (a backtick would end the span early). */
function inlineCode(line: string): string {
  return `\`${line.trim().replace(/`/g, "'")}\``;
}

/**
 * The lesson body, as lib/markdown-blocks.ts reads it and LessonBody draws
 * it: the source block (each passage a quote, then the code), then the AI
 * explanation under its own heading and note — its paragraphs, the
 * walk-through as a list led by the code line each item explains, and the
 * closing line.
 */
export function renderLessonBody(source: SourceBlock, e: Explanation): string {
  const out: string[] = [`## ${SOURCE_HEADING}`];
  for (const p of source.passages) out.push(`> ${p}`);
  const codeLines = source.code === null ? [] : source.code.split("\n");
  if (source.code !== null) out.push("```\n" + source.code + "\n```");
  out.push(`## ${AI_HEADING}`, `*${AI_NOTE}*`);
  for (const p of e.meaning) out.push(p.sentences.map((s) => s.trim()).join(" "));
  if (e.walkthrough.length > 0) {
    out.push(e.walkthrough.map((w) => `- ${inlineCode(codeLines[w.line - 1] ?? "")} — ${w.sentences.map((s) => s.trim()).join(" ")}`).join("\n"));
  }
  out.push(e.closing.trim());
  return out.join("\n\n");
}

/** Reading time for the "n MIN READ" line: 200 words a minute, at least 1. */
export function minutesToRead(markdown: string): number {
  const prose = markdown.replace(/```[\s\S]*?```/g, " ");
  return Math.max(1, Math.round(wordCount(prose) / 200));
}
