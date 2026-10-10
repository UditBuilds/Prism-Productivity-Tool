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

/** What the one fix (or the removals after it) does to the explanation. */
export interface Changes {
  /** By sentence id (sentencesOf numbering): the new sentence, or "" to remove it. */
  replace?: Map<number, string>;
  /** By sentence id: new sentences that go just before it (before the closing line: at the end of the part before it). */
  before?: Map<number, string[]>;
  /** New sentences that open the meaning. */
  atStart?: string[];
}

/**
 * The explanation with the changes made. A paragraph left empty goes; a
 * walk-through item left empty stays, so the shape check reports the code
 * line it no longer explains; a removed closing line leaves "", which the
 * shape check reports. Returns the new explanation and the ids, in ITS
 * numbering, of the sentences that are new.
 */
export function withChanges(e: Explanation, changes: Changes): { explanation: Explanation; changed: number[] } {
  const replace = changes.replace ?? new Map<number, string>();
  const before = changes.before ?? new Map<number, string[]>();
  type Slot = { text: string; isNew: boolean };
  const meaning: Slot[][] = e.meaning.map(() => []);
  const walkthrough: Slot[][] = e.walkthrough.map(() => []);
  if (changes.atStart?.length) {
    if (meaning.length === 0) meaning.push([]);
    meaning[0].push(...changes.atStart.map((text) => ({ text, isNew: true })));
  }
  let id = 0;
  const visit = (into: Slot[], text: string) => {
    id += 1;
    for (const t of before.get(id) ?? []) into.push({ text: t, isNew: true });
    const r = replace.get(id);
    if (r === undefined) into.push({ text, isNew: false });
    else if (r.trim()) into.push({ text: r.trim(), isNew: true });
  };
  e.meaning.forEach((p, g) => p.sentences.forEach((text) => visit(meaning[g], text)));
  e.walkthrough.forEach((w, g) => w.sentences.forEach((text) => visit(walkthrough[g], text)));
  id += 1;
  const lastPart = walkthrough.length > 0 ? walkthrough[walkthrough.length - 1] : meaning[meaning.length - 1];
  for (const t of before.get(id) ?? []) lastPart?.push({ text: t, isNew: true });
  const r = replace.get(id);
  const closing: Slot = r === undefined ? { text: e.closing, isNew: false } : { text: r.trim(), isNew: Boolean(r.trim()) };

  const kept = meaning.filter((p) => p.length > 0);
  const ordered = [...kept.flat(), ...walkthrough.flat(), closing];
  return {
    explanation: {
      meaning: kept.map((p) => ({ sentences: p.map((s) => s.text) })),
      walkthrough: e.walkthrough.map((w, g) => ({ line: w.line, sentences: walkthrough[g].map((s) => s.text) })),
      closing: closing.text,
    },
    changed: ordered.flatMap((s, i) => (s.isNew ? [i + 1] : [])),
  };
}

/** Words that count toward 150-500: every sentence, the closing line included. */
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
  /** G2 only: its verdict. After the fix, "contradicts" fails the step; "unsupported" and "filler" are removed. */
  verdict?: "contradicts" | "unsupported" | "filler";
  text: string;
  reason: string;
}

/** The code's non-blank line numbers (1-based): the lines the walk-through must explain. */
export function linesToWalk(code: string | null): number[] {
  if (code === null) return [];
  return code.split("\n").flatMap((l, i) => (l.trim() ? [i + 1] : []));
}

/**
 * The shape rules, all checked in code: at least one paragraph saying what it
 * means, then one walk-through item for every non-blank code line in order,
 * then one closing sentence; 150-500 words.
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

// ─── unexplained words ────────────────────────────────────────────────────

/** Does the text use the word? Case does not matter, and "argument", "arguments" and "argument(s)" are one word. */
export function mentionsWord(text: string, word: string): boolean {
  const w = word.toLowerCase().trim();
  if (!w) return false;
  const stem = w.endsWith("ies") && w.length > 4 ? w.slice(0, -3) : w.endsWith("es") && /(?:s|x|z|ch|sh)es$/.test(w) ? w.slice(0, -2) : w.endsWith("s") && !w.endsWith("ss") && w.length > 3 ? w.slice(0, -1) : w;
  const tail = w.endsWith("ies") || w.endsWith("y") ? "(?:y|ies)" : "(?:s|es|\\(s\\))?";
  const base = w.endsWith("y") ? stem.slice(0, -1) : stem;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_])${escaped}${tail}($|[^a-z0-9_])`, "i").test(text);
}

/**
 * Where the one short sentence explaining a word goes (Udit, 2026-10-10:
 * explained the first time it appears). A word the source block uses — the
 * reader meets it there first, and the source is shown word for word — is
 * explained at the start of the meaning; any other word just before the
 * first sentence that uses it. Null when the lesson does not use the word at
 * all (the judge named a word that is not there).
 */
export function wordPlace(word: string, source: SourceBlock, sentences: Sentence[]): "start" | number | null {
  if ([...source.passages, source.code ?? ""].some((t) => mentionsWord(t, word))) return "start";
  return sentences.find((s) => mentionsWord(s.text, word))?.id ?? null;
}

// ─── after the one fix ────────────────────────────────────────────────────

/**
 * What happens after the one fix (Udit, 2026-10-10), given the problems the
 * checks still find in the new sentences:
 *   - a sentence G2 still finds contradicting the source fails the step;
 *   - a G1 or link problem still fails the step (G1 is unchanged);
 *   - a sentence still unsupported or filler is REMOVED;
 * then the lesson is saved only if its shape still holds.
 */
export function settleAfterFix(
  e: Explanation,
  problems: Problem[],
  source: SourceBlock
): { kind: "fail"; reasons: string[] } | { kind: "save"; explanation: Explanation; removed: { sentence: Sentence; problem: Problem }[] } {
  const describe = (p: Problem) => (p.sentence === null ? p.reason : `sentence ${p.sentence} (${p.check}${p.verdict ? `, ${p.verdict}` : ""}): ${p.reason}`);
  const hard = problems.filter((p) => p.check !== "G2" || p.verdict === "contradicts");
  if (hard.length > 0) return { kind: "fail", reasons: hard.map(describe) };
  const all = sentencesOf(e);
  const removed = problems.map((problem) => ({ sentence: all.find((s) => s.id === problem.sentence) as Sentence, problem }));
  const after = withChanges(e, { replace: new Map(removed.map((r) => [r.sentence.id, ""])) }).explanation;
  const shape = checkShape(after, source);
  if (shape.length > 0) {
    return { kind: "fail", reasons: [...removed.map((r) => `removed ${describe(r.problem)}`), ...shape.map((p) => `then ${p.reason}`)] };
  }
  return { kind: "save", explanation: after, removed };
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
