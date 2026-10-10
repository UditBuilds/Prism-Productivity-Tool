import {
  CITED_LINES_PER_TEACH_LINE,
  LESSON_MAX_WORDS,
  LESSON_MIN_WORDS,
} from "@/lib/learning/constants";
import type { Passage } from "@/lib/learning/passages";
import { URL_IN_TEXT } from "@/lib/learning/sources";

/**
 * The lesson as the writer returns it, and the rules checked in CODE rather
 * than trusted to the prompt. Pure.
 *
 * The writer is given numbered passages that the server has already found
 * word for word in the source pages (passages.ts), and returns one line per
 * sentence or list item:
 *
 *   TITLE: What a variable is
 *   SUMMARY: A variable is a name that refers to a value.
 *   ## Giving a value a name
 *   [P3] → The equal sign gives a value to a variable.
 *   [teach] → Think of a variable as a label you stick on a value.
 *   - [P4, P5] → A list item backed by two passages.
 *   EXAMPLE [P6]
 *   OUTPUT [P7]
 *
 * A [Pn] line says what its passages say. A [teach] line (decision 1) cites
 * nothing because it may add nothing: it defines a term in plain words,
 * links two points, or walks through the example. The writer never types
 * code: EXAMPLE names a code passage and the server shows that passage's own
 * lines (decision 2), so an example can only be code a source shows, and an
 * expected output only appears when a source shows one.
 *
 * Why not JSON: measured 2026-10-09, 3 of 9 nested-JSON drafts were refused
 * by Groq's JSON mode. A line that does not fit here is reported and the
 * rest survives.
 */

export interface Claim {
  text: string;
  /** Passage ids this line cites. Empty for a [teach] line. */
  cites: number[];
  teach: boolean;
  /** The line had no [Pn] or [teach] tag. It is never shown: it must be replaced. */
  untagged?: boolean;
}

export type LessonBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; sentences: Claim[] }
  | { type: "list"; items: Claim[] };

export interface LessonExample {
  /** Index into `blocks`: the example is shown after that block. */
  afterBlock: number;
  /** The code passage shown as the example. */
  passage: number;
  /** A code passage showing what it prints, only if a source shows one. */
  output: number | null;
}

export interface DraftLesson {
  title: string;
  summary: string;
  blocks: LessonBlock[];
  example: LessonExample | null;
  /** What was left out and why: chatter before the title, code the writer typed. */
  dropped: string[];
}

export class LessonFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LessonFormatError";
  }
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const TAGS = String.raw`((?:\[[^\]\n]{1,40}\]\s*)+)`;
const CLAIM_RE = new RegExp(String.raw`^(?:([-*•])\s+)?${TAGS}(?:→|->|=>|—>|:)?\s*(.+)$`);
const TEACH_TAG = /\[\s*teach\s*\]/i;
const P_TAG = /\[\s*(P\s*\d{1,2}(?:\s*(?:,|;|&|and)\s*P?\s*\d{1,2})*)\s*\]/gi;
const PASSAGE_REF = String.raw`\[\s*P?\s*(\d{1,2})\s*\]`;
const EXAMPLE_RE = new RegExp(String.raw`^EXAMPLE\s*:?\s*${PASSAGE_REF}`, "i");
const OUTPUT_RE = new RegExp(String.raw`^OUTPUT\s*:?\s*${PASSAGE_REF}`, "i");

/** One sentence line, or null when the line is not a sentence at all. */
export function parseClaimLine(line: string): { claim: Claim; item: boolean } | null {
  const m = CLAIM_RE.exec(line.trim());
  if (m) {
    const tags = m[2];
    const cites = Array.from(tags.matchAll(P_TAG)).flatMap((t) =>
      Array.from(t[1].matchAll(/\d{1,2}/g), (d) => Number(d[0]))
    );
    const text = clean(m[3]);
    if (!text) return null;
    const unique = Array.from(new Set(cites)).slice(0, 3);
    if (unique.length > 0) return { claim: { text, cites: unique, teach: false }, item: Boolean(m[1]) };
    if (TEACH_TAG.test(tags)) return { claim: { text, cites: [], teach: true }, item: Boolean(m[1]) };
    // A bracket that is neither [Pn] nor [teach], e.g. the old "[source 1]".
    return { claim: { text: clean(line.replace(/^[-*•]\s+/, "")), cites: [], teach: false, untagged: true }, item: Boolean(m[1]) };
  }
  const item = /^[-*•]\s+(.+)$/.exec(line.trim());
  const text = clean(item ? item[1] : line);
  if (!text || /^[-*_=]{3,}$/.test(text)) return null;
  return { claim: { text, cites: [], teach: false, untagged: true }, item: Boolean(item) };
}

function skipFence(lines: string[], from: number): number {
  let i = from;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i >= lines.length || !lines[i].trim().startsWith("```")) return from - 1;
  i++;
  while (i < lines.length && !lines[i].trim().startsWith("```")) i++;
  return i;
}

/** Parse the writer's answer. Throws only when nothing usable came back. */
export function parseDraftLesson(content: string): DraftLesson {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const lesson: DraftLesson = { title: "", summary: "", blocks: [], example: null, dropped: [] };
  let open: { type: "paragraph"; sentences: Claim[] } | { type: "list"; items: Claim[] } | null = null;
  const close = () => {
    if (open) lesson.blocks.push(open);
    open = null;
  };
  const started = () => Boolean(lesson.title) || lesson.blocks.length > 0 || open !== null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      close();
      continue;
    }
    const title = /^TITLE\s*:\s*(.+)$/i.exec(line);
    if (title) {
      lesson.title = clean(title[1]);
      continue;
    }
    const summary = /^SUMMARY\s*:\s*(.+)$/i.exec(line);
    if (summary) {
      lesson.summary = clean(summary[1]);
      continue;
    }
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      close();
      lesson.blocks.push({ type: "heading", text: clean(heading[1]) });
      continue;
    }
    const example = EXAMPLE_RE.exec(line);
    if (example || /^EXAMPLE\b/i.test(line)) {
      close();
      const typed = skipFence(lines, i + 1);
      if (typed >= i + 1) {
        lesson.dropped.push("code the writer typed under EXAMPLE (only a source's code is shown)");
        i = typed;
      }
      if (!example) {
        lesson.dropped.push("an EXAMPLE line without a [Pn] passage");
        continue;
      }
      // Only the first example is kept: one example per lesson, by construction.
      if (!lesson.example) lesson.example = { passage: Number(example[1]), output: null, afterBlock: lesson.blocks.length - 1 };
      continue;
    }
    const output = OUTPUT_RE.exec(line);
    if (output || /^OUTPUT\b/i.test(line)) {
      close();
      const typed = skipFence(lines, i + 1);
      if (typed >= i + 1) {
        lesson.dropped.push("output the writer typed (only a source's output is shown)");
        i = typed;
      }
      if (output && lesson.example && lesson.example.output === null) lesson.example.output = Number(output[1]);
      else if (!output) lesson.dropped.push("an OUTPUT line without a [Pn] passage");
      continue;
    }
    if (line.startsWith("```")) {
      const end = skipFence(lines, i);
      lesson.dropped.push("a code block outside EXAMPLE");
      i = Math.max(i, end);
      continue;
    }
    const parsed = parseClaimLine(line);
    if (!parsed) continue;
    if (!started() && parsed.claim.untagged) {
      // Chatter before the lesson ("Sure! Here is your lesson.").
      lesson.dropped.push(line.slice(0, 120));
      continue;
    }
    if (parsed.item) {
      if (!open || open.type !== "list") {
        close();
        open = { type: "list", items: [] };
      }
      open.items.push(parsed.claim);
    } else {
      if (!open || open.type !== "paragraph") {
        close();
        open = { type: "paragraph", sentences: [] };
      }
      open.sentences.push(parsed.claim);
    }
  }
  close();

  if (!lesson.title && lesson.blocks.length === 0) {
    throw new LessonFormatError("The AI's answer was not in the lesson format.");
  }
  return lesson;
}

/** Every claim in reading order. Line numbers in problems are 1-based indexes into this. */
export function claimsOf(lesson: DraftLesson): Claim[] {
  return lesson.blocks.flatMap((b) =>
    b.type === "paragraph" ? b.sentences : b.type === "list" ? b.items : []
  );
}

function words(s: string): number {
  return (s.match(/[A-Za-z0-9'’_-]+/g) ?? []).length;
}

/** Prose words: headings, sentences and list items. The example is not counted. */
export function proseWordCount(lesson: DraftLesson): number {
  return lesson.blocks.reduce((n, b) => {
    if (b.type === "heading") return n + words(b.text);
    const claims = b.type === "paragraph" ? b.sentences : b.items;
    return n + claims.reduce((m, c) => m + words(c.text), 0);
  }, 0);
}

/**
 * One thing wrong with a draft. `line` (1-based, claimsOf order) marks a
 * sentence the fix turn can replace; `where` names the rest: "title",
 * "summary", "length", "example", or "lesson" for what no fix can mend.
 */
export interface LessonProblem {
  line: number | null;
  where: string;
  text: string;
  reason: string;
}

/**
 * Decision 11's mechanical rules, and decision 1's share of [teach] lines.
 * Grounding (what each line may say) is checked separately, in grounding.ts.
 */
export function checkLessonRules(lesson: DraftLesson): LessonProblem[] {
  const problems: LessonProblem[] = [];
  const claims = claimsOf(lesson);
  if (!lesson.title || lesson.title.length > 90) {
    problems.push({ line: null, where: "title", text: lesson.title, reason: "the title must be 1 to 90 characters" });
  }
  if (!lesson.summary || lesson.summary.length > 200) {
    problems.push({ line: null, where: "summary", text: lesson.summary, reason: "the summary must be one sentence under 200 characters" });
  }
  if (claims.length === 0) {
    problems.push({ line: null, where: "lesson", text: "", reason: "the lesson has no sentences" });
    return problems;
  }
  for (const [where, text] of [["title", lesson.title], ["summary", lesson.summary]] as const) {
    if (URL_IN_TEXT.test(text)) problems.push({ line: null, where, text, reason: "no links; refer to sources only through passages" });
  }

  claims.forEach((c, i) => {
    const line = i + 1;
    if (c.untagged) {
      problems.push({ line, where: `line ${line}`, text: c.text, reason: "it has no [Pn] or [teach] tag; every sentence needs one" });
      return;
    }
    if (URL_IN_TEXT.test(c.text)) problems.push({ line, where: `line ${line}`, text: c.text, reason: "it contains a link" });
    if (c.text.includes("```")) problems.push({ line, where: `line ${line}`, text: c.text, reason: "code belongs in EXAMPLE, never in a sentence" });
  });

  // Decision 1: at most one [teach] line for every two cited lines. The
  // surplus is asked to become cited lines — the LAST ones, since the
  // definitions a beginner needs come first.
  const cited = claims.filter((c) => !c.untagged && !c.teach).length;
  const teachLines = claims.map((c, i) => ({ c, line: i + 1 })).filter((x) => x.c.teach);
  const allowed = Math.floor(cited / CITED_LINES_PER_TEACH_LINE);
  if (teachLines.length > allowed) {
    for (const x of teachLines.slice(allowed)) {
      problems.push({
        line: x.line,
        where: `line ${x.line}`,
        text: x.c.text,
        reason: `too many [teach] lines (${teachLines.length} for ${cited} cited); rewrite this as a [Pn] line that cites a passage`,
      });
    }
  }

  const count = proseWordCount(lesson);
  if (count < LESSON_MIN_WORDS || count > LESSON_MAX_WORDS) {
    problems.push({ line: null, where: "length", text: String(count), reason: `the lesson is ${count} words; it must be ${LESSON_MIN_WORDS} to ${LESSON_MAX_WORDS}` });
  }
  return problems;
}

/**
 * An EXAMPLE or OUTPUT line the source does not back is dropped, not failed:
 * it is not a sentence, so leaving it out changes no claim, and nothing
 * unverified is shown in its place (decision 2).
 *
 * EXAMPLE must name a code passage. OUTPUT must name the code block that
 * comes RIGHT AFTER the example's block on the same page: any other code
 * passage would show a beginner unrelated code as "Expected output". OUTPUT
 * naming the example's own passage is dropped too, as it already shows it.
 */
export function settleExample(lesson: DraftLesson, passages: Passage[]): DraftLesson {
  if (!lesson.example) return lesson;
  const code = (id: number | null) => (id === null ? undefined : passages.find((p) => p.id === id && p.kind === "code"));
  const dropped = [...lesson.dropped];
  const example = code(lesson.example.passage);
  if (!example) {
    dropped.push(`EXAMPLE [P${lesson.example.passage}] (not a code passage)`);
    return { ...lesson, example: null, dropped };
  }
  const id = lesson.example.output;
  if (id === null) return lesson;
  const output = code(id);
  const why =
    id === lesson.example.passage
      ? "the example already shows it"
      : !output
        ? "not a code passage"
        : output.source !== example.source || example.block === undefined || output.block !== example.block + 1
          ? "not the code block right after the example on its page"
          : null;
  if (why === null) return lesson;
  dropped.push(`OUTPUT [P${id}] (${why})`);
  return { ...lesson, example: { ...lesson.example, output: null }, dropped };
}

/**
 * Headings make no claim, so one that fails a check (a number no cited
 * passage holds) is dropped rather than failing the lesson. `numbers` are
 * the 1-based heading numbers, as checkGrounding's "heading n" names them.
 */
export function dropHeadings(lesson: DraftLesson, numbers: number[]): DraftLesson {
  if (numbers.length === 0) return lesson;
  let h = 0;
  const removedAt: number[] = [];
  const blocks = lesson.blocks.filter((b, i) => {
    if (b.type !== "heading") return true;
    h += 1;
    if (!numbers.includes(h)) return true;
    removedAt.push(i);
    return false;
  });
  const example = lesson.example
    ? { ...lesson.example, afterBlock: lesson.example.afterBlock - removedAt.filter((i) => i <= lesson.example!.afterBlock).length }
    : null;
  const dropped = [...lesson.dropped, ...numbers.map((n) => `heading ${n} (a number no cited passage holds)`)];
  return { ...lesson, blocks, example, dropped };
}

// ─── the fix turn ──────────────────────────────────────────────────────────

export interface FixAnswer {
  /** Replacement lines by the line number they replace. */
  lines: Map<number, { claim: Claim; item: boolean }>;
  title: string | null;
  summary: string | null;
  /** New lines to add at the end of the lesson. */
  added: { claim: Claim; item: boolean }[];
}

/** Read the fix turn's answer: "L4: [P3] → …", "TITLE: …", "SUMMARY: …", "ADD: [P5] → …". */
export function parseFixAnswer(content: string): FixAnswer {
  const out: FixAnswer = { lines: new Map(), title: null, summary: null, added: [] };
  for (const raw of content.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const l = /^L(\d{1,3})\s*[:.)-]\s*(.+)$/i.exec(line);
    if (l) {
      const parsed = parseClaimLine(l[2]);
      if (parsed && !out.lines.has(Number(l[1]))) out.lines.set(Number(l[1]), parsed);
      continue;
    }
    const add = /^ADD\s*[:.)-]\s*(.+)$/i.exec(line);
    if (add) {
      const parsed = parseClaimLine(add[1]);
      if (parsed) out.added.push(parsed);
      continue;
    }
    const title = /^TITLE\s*:\s*(.+)$/i.exec(line);
    if (title) out.title = clean(title[1]);
    const summary = /^SUMMARY\s*:\s*(.+)$/i.exec(line);
    if (summary) out.summary = clean(summary[1]);
  }
  return out;
}

/**
 * Splice a fix answer into the draft: each replaced line stays where it was,
 * added lines go at the end. Returns the new lesson and the line numbers
 * that are new or changed — the only lines the meaning check reads again —
 * and the asked-for lines the answer did not replace.
 */
export function applyFix(
  lesson: DraftLesson,
  fix: FixAnswer,
  asked: number[]
): { lesson: DraftLesson; changed: number[]; missing: number[] } {
  let n = 0;
  const changedClaims = new Set<Claim>();
  const replace = (c: Claim): Claim => {
    n += 1;
    const r = fix.lines.get(n);
    if (!r || !asked.includes(n)) return c;
    changedClaims.add(r.claim);
    return r.claim;
  };
  const blocks: LessonBlock[] = lesson.blocks.map((b) =>
    b.type === "paragraph"
      ? { ...b, sentences: b.sentences.map(replace) }
      : b.type === "list"
        ? { ...b, items: b.items.map(replace) }
        : b
  );
  if (fix.added.length > 0) {
    const sentences = fix.added.map((a) => a.claim);
    sentences.forEach((c) => changedClaims.add(c));
    const last = blocks[blocks.length - 1];
    if (last && last.type === "paragraph") blocks[blocks.length - 1] = { ...last, sentences: [...last.sentences, ...sentences] };
    else blocks.push({ type: "paragraph", sentences });
  }
  const next: DraftLesson = {
    ...lesson,
    title: fix.title ?? lesson.title,
    summary: fix.summary ?? lesson.summary,
    blocks,
  };
  const changed = claimsOf(next)
    .map((c, i) => (changedClaims.has(c) ? i + 1 : 0))
    .filter((x) => x > 0);
  const missing = asked.filter((a) => !fix.lines.has(a));
  return { lesson: next, changed, missing };
}

// ─── rendering ─────────────────────────────────────────────────────────────

/** Sentences per displayed paragraph before a long one is split. */
export const PARAGRAPH_SENTENCES = 5;

/**
 * The stored lesson body. One line per paragraph, as lib/markdown-blocks.ts
 * reads it. The example and its output are the passages' own lines.
 */
export function renderLessonMarkdown(lesson: DraftLesson, passages: Passage[]): string {
  const out: string[] = [];
  const code = (id: number | null) => (id === null ? null : passages.find((p) => p.id === id && p.kind === "code") ?? null);
  const pushExample = () => {
    if (!lesson.example) return;
    const example = code(lesson.example.passage);
    if (!example) return;
    out.push("```python\n" + example.text + "\n```");
    const output = code(lesson.example.output);
    if (output) {
      out.push("Expected output:");
      out.push("```text\n" + output.text + "\n```");
    }
  };
  const after = lesson.example
    ? Math.min(Math.max(lesson.example.afterBlock, 0), lesson.blocks.length - 1)
    : -1;
  lesson.blocks.forEach((b, i) => {
    if (b.type === "heading") out.push(`### ${b.text}`);
    else if (b.type === "paragraph") {
      // A long paragraph is split into readable chunks of at most
      // PARAGRAPH_SENTENCES sentences, as evenly as the count allows.
      const parts = Math.ceil(b.sentences.length / PARAGRAPH_SENTENCES);
      const size = Math.ceil(b.sentences.length / parts);
      for (let k = 0; k < b.sentences.length; k += size) {
        out.push(b.sentences.slice(k, k + size).map((s) => s.text).join(" "));
      }
    } else out.push(b.items.map((it) => `- ${it.text}`).join("\n"));
    if (i === after) pushExample();
  });
  if (lesson.example && after === -1) pushExample();
  return out.join("\n\n");
}

/** Reading time for the "n MIN READ" line: 200 words a minute, at least 1. */
export function minutesToRead(markdown: string): number {
  const prose = markdown.replace(/```[\s\S]*?```/g, " ");
  return Math.max(1, Math.round(words(prose) / 200));
}
