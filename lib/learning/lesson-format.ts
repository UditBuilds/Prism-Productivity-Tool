import { LESSON_MAX_WORDS, LESSON_MIN_WORDS, MAX_DEFINE_LINES, NOT_FROM_SOURCE } from "@/lib/learning/constants";
import type { Passage } from "@/lib/learning/passages";
import { URL_IN_TEXT } from "@/lib/learning/sources";

/**
 * The lesson as the writer returns it, and the rules checked in CODE rather
 * than trusted to the prompt. Pure.
 *
 * Fixed order, no headings (Udit's decision, 2026-10-10):
 *
 *   TITLE: What a variable is
 *   SUMMARY: A variable is a name that refers to a value.
 *
 *   [P3] → The equal sign gives a value to a variable.        EXPLAIN:
 *   [teach] → Think of a name you can use again later.         2-4 short
 *   [define: value] → A value is a piece of data.              paragraphs
 *
 *   [P4] → Here is that in the interpreter:
 *
 *   EXAMPLE [P6]                                               the source's code
 *
 *   [line 1] → `width = 20` gives the name width the value 20. WALK-THROUGH,
 *   [lines 3-4] → Python multiplies them and shows 900.        line by line
 *
 *   [close] → A variable is a name for a value, set with =.    CLOSE
 *
 * Line kinds: [Pn] says what its passages say; [teach] adds nothing
 * (decision 1); [define: term] is one plain definition of a term no passage
 * defines, shown to the reader marked "not from a source"; [line n] explains
 * code lines of the example; [close] restates what was already said. The
 * writer never types code: EXAMPLE names a code passage and the page's own
 * lines are shown (decision 2).
 *
 * Why not JSON: measured 2026-10-09, 3 of 9 nested-JSON drafts were refused
 * by Groq's JSON mode. A line that does not fit here is reported and the
 * rest survives.
 */

export type LineKind = "cited" | "teach" | "define" | "walk" | "close" | "untagged";

export interface Line {
  kind: LineKind;
  text: string;
  /** cited: the passage ids it rests on. */
  cites: number[];
  /** define: the term it defines (lower case). */
  term: string | null;
  /** walk: the example's code lines it explains, 1-based and inclusive. */
  codeLines: [number, number] | null;
}

export type LessonItem =
  | { type: "line"; line: Line }
  /** A paragraph break in EXPLAIN. */
  | { type: "break" }
  | { type: "example"; passage: number; output: number | null };

export interface DraftLesson {
  title: string;
  summary: string;
  items: LessonItem[];
  /** What was left out and why: chatter, headings, code the writer typed. */
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

const ARROW = String.raw`\s*(?:→|->|=>|—>|:)?\s*`;
const CLOSE_RE = new RegExp(String.raw`^(?:\[\s*close\s*\]|CLOSE\b)${ARROW}(.+)$`, "i");
const WALK_RE = new RegExp(String.raw`^\[\s*lines?\s*(\d{1,2})\s*(?:(?:-|–|to)\s*(\d{1,2}))?\s*\]${ARROW}(.+)$`, "i");
const DEFINE_RE = new RegExp(String.raw`^\[\s*define\s*:?\s*([^\]]{1,60})\]${ARROW}(.+)$`, "i");
const TEACH_RE = new RegExp(String.raw`^\[\s*teach\s*\]${ARROW}(.+)$`, "i");
const CITED_RE = new RegExp(String.raw`^((?:\[\s*P\s*\d{1,2}(?:\s*(?:,|;|&|and)\s*P?\s*\d{1,2})*\s*\]\s*)+)${ARROW}(.+)$`, "i");
const PASSAGE_REF = String.raw`\[\s*P?\s*(\d{1,2})\s*\]`;
const EXAMPLE_RE = new RegExp(String.raw`^EXAMPLE\s*:?\s*${PASSAGE_REF}`, "i");
const OUTPUT_RE = new RegExp(String.raw`^OUTPUT\s*:?\s*${PASSAGE_REF}`, "i");

const line = (kind: LineKind, text: string, extra: Partial<Line> = {}): Line => ({
  kind,
  text: clean(text),
  cites: [],
  term: null,
  codeLines: null,
  ...extra,
});

/** One sentence line, or null when the line holds no sentence at all. */
export function parseLine(raw: string): Line | null {
  const s = raw.trim().replace(/^[-*•]\s+/, "");
  if (!s || /^[-*_=]{3,}$/.test(s)) return null;
  let m = CLOSE_RE.exec(s);
  if (m) return clean(m[1]) ? line("close", m[1]) : null;
  m = WALK_RE.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    return clean(m[3]) ? line("walk", m[3], { codeLines: [Math.min(a, b), Math.max(a, b)] }) : null;
  }
  m = DEFINE_RE.exec(s);
  if (m) return clean(m[2]) ? line("define", m[2], { term: clean(m[1]).toLowerCase().replace(/^["'“”`]|["'“”`]$/g, "") }) : null;
  m = TEACH_RE.exec(s);
  if (m) return clean(m[1]) ? line("teach", m[1]) : null;
  m = CITED_RE.exec(s);
  if (m) {
    const cites = Array.from(new Set(Array.from(m[1].matchAll(/\d{1,2}/g), (d) => Number(d[0])))).slice(0, 3);
    return clean(m[2]) ? line("cited", m[2], { cites }) : null;
  }
  // No tag, or one this format does not know (the old "[source 1] «…»").
  return line("untagged", s);
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
  const raw = content.replace(/\r\n/g, "\n").split("\n");
  const lesson: DraftLesson = { title: "", summary: "", items: [], dropped: [] };
  const push = (item: LessonItem) => {
    const last = lesson.items[lesson.items.length - 1];
    if (item.type === "break" && (!last || last.type === "break")) return;
    lesson.items.push(item);
  };
  const started = () => Boolean(lesson.title) || lesson.items.some((x) => x.type === "line");
  const example = () => lesson.items.find((x): x is Extract<LessonItem, { type: "example" }> => x.type === "example");

  for (let i = 0; i < raw.length; i++) {
    const text = raw[i].trim();
    if (!text) {
      push({ type: "break" });
      continue;
    }
    const title = /^TITLE\s*:\s*(.+)$/i.exec(text);
    if (title) {
      lesson.title = clean(title[1]);
      continue;
    }
    const summary = /^SUMMARY\s*:\s*(.+)$/i.exec(text);
    if (summary) {
      lesson.summary = clean(summary[1]);
      continue;
    }
    if (/^#{1,6}\s+/.test(text)) {
      lesson.dropped.push(`a heading (lessons have none): ${text.slice(0, 80)}`);
      push({ type: "break" });
      continue;
    }
    const ex = EXAMPLE_RE.exec(text);
    if (ex || /^EXAMPLE\b/i.test(text)) {
      const typed = skipFence(raw, i + 1);
      if (typed >= i + 1) {
        lesson.dropped.push("code the writer typed under EXAMPLE (only a source's code is shown)");
        i = typed;
      }
      if (!ex) lesson.dropped.push("an EXAMPLE line without a [Pn] passage");
      else if (example()) lesson.dropped.push(`a second EXAMPLE [P${ex[1]}] (one per lesson)`);
      else lesson.items.push({ type: "example", passage: Number(ex[1]), output: null });
      continue;
    }
    const out = OUTPUT_RE.exec(text);
    if (out || /^OUTPUT\b/i.test(text)) {
      const typed = skipFence(raw, i + 1);
      if (typed >= i + 1) {
        lesson.dropped.push("output the writer typed (only a source's output is shown)");
        i = typed;
      }
      const target = example();
      if (out && target && target.output === null) target.output = Number(out[1]);
      else lesson.dropped.push(out ? `OUTPUT [P${out[1]}] with no example before it` : "an OUTPUT line without a [Pn] passage");
      continue;
    }
    if (text.startsWith("```")) {
      i = Math.max(i, skipFence(raw, i));
      lesson.dropped.push("a code block outside EXAMPLE (only a source's code is shown)");
      continue;
    }
    const parsed = parseLine(text);
    if (!parsed) continue;
    if (!started() && parsed.kind === "untagged") {
      // Chatter before the lesson ("Sure! Here is your lesson.").
      lesson.dropped.push(text.slice(0, 120));
      continue;
    }
    lesson.items.push({ type: "line", line: parsed });
  }
  while (lesson.items[lesson.items.length - 1]?.type === "break") lesson.items.pop();

  if (!lesson.title && !lesson.items.some((x) => x.type === "line")) {
    throw new LessonFormatError("The AI's answer was not in the lesson format.");
  }
  return lesson;
}

/** Every line in reading order. Line numbers in problems are 1-based indexes into this. */
export function linesOf(lesson: DraftLesson): Line[] {
  return lesson.items.flatMap((x) => (x.type === "line" ? [x.line] : []));
}

export function exampleOf(lesson: DraftLesson): { passage: number; output: number | null } | null {
  const ex = lesson.items.find((x) => x.type === "example");
  return ex && ex.type === "example" ? { passage: ex.passage, output: ex.output } : null;
}

const EXPLAIN_KINDS: LineKind[] = ["cited", "teach", "define", "untagged"];

export interface LessonParts {
  /** EXPLAIN as the writer broke it into paragraphs. */
  explain: Line[][];
  walk: Line[];
  close: Line | null;
  /** Lines in the wrong part of the lesson, with why. */
  misplaced: { line: Line; why: string }[];
}

/** Read the lesson's parts in their fixed order: EXPLAIN, EXAMPLE, WALK-THROUGH, CLOSE. */
export function partsOf(lesson: DraftLesson): LessonParts {
  const parts: LessonParts = { explain: [], walk: [], close: null, misplaced: [] };
  const all = linesOf(lesson);
  const last = all[all.length - 1];
  const hasExample = lesson.items.some((x) => x.type === "example");
  let afterExample = false;
  let paragraph: Line[] = [];
  const endParagraph = () => {
    if (paragraph.length) parts.explain.push(paragraph);
    paragraph = [];
  };
  for (const item of lesson.items) {
    if (item.type === "break") {
      if (!afterExample) endParagraph();
      continue;
    }
    if (item.type === "example") {
      endParagraph();
      afterExample = true;
      continue;
    }
    const l = item.line;
    if (l.kind === "close") {
      if (l === last && parts.close === null) parts.close = l;
      else parts.misplaced.push({ line: l, why: "the closing line must be the last line, and there is only one" });
      continue;
    }
    if (!afterExample) {
      if (l.kind === "walk") {
        parts.misplaced.push({
          line: l,
          why: hasExample ? "a walk-through line must come after the EXAMPLE" : "a walk-through line, but the lesson has no EXAMPLE",
        });
      } else paragraph.push(l);
      continue;
    }
    if (l.kind === "walk") parts.walk.push(l);
    else if (EXPLAIN_KINDS.includes(l.kind)) {
      parts.misplaced.push({ line: l, why: "after the EXAMPLE come only [line n] lines and one [close] line" });
    }
  }
  endParagraph();
  return parts;
}

function words(s: string): number {
  return (s.match(/[A-Za-z0-9'’_-]+/g) ?? []).length;
}

/**
 * Words that count toward 300-500: every sentence line — explain, walk-through
 * and close. The title and summary do not count (Udit, 2026-10-10), nor does
 * the example's code.
 */
export function proseWordCount(lesson: DraftLesson): number {
  return linesOf(lesson).reduce((n, l) => n + words(l.text), 0);
}

/**
 * One thing wrong with a draft. `line` (1-based, linesOf order) marks a line
 * the fix turn can replace; `where` names the rest: "title", "summary",
 * "length", "close", "example", "walk", "terms", or "lesson" for what no fix
 * can mend.
 */
export interface LessonProblem {
  line: number | null;
  where: string;
  text: string;
  reason: string;
}

/**
 * The format and structure rules that need no passages. What each line may
 * SAY, the example and its walk-through coverage are checked in grounding.ts.
 */
export function checkLessonRules(lesson: DraftLesson): LessonProblem[] {
  const problems: LessonProblem[] = [];
  const all = linesOf(lesson);
  const at = (l: Line) => all.indexOf(l) + 1;
  const lineProblem = (l: Line, reason: string) => problems.push({ line: at(l), where: `line ${at(l)}`, text: l.text, reason });

  if (!lesson.title || lesson.title.length > 90) {
    problems.push({ line: null, where: "title", text: lesson.title, reason: "the title must be 1 to 90 characters" });
  }
  if (!lesson.summary || lesson.summary.length > 200) {
    problems.push({ line: null, where: "summary", text: lesson.summary, reason: "the summary must be one sentence under 200 characters" });
  }
  for (const [where, text] of [["title", lesson.title], ["summary", lesson.summary]] as const) {
    if (URL_IN_TEXT.test(text)) problems.push({ line: null, where, text, reason: "no links" });
  }
  const parts = partsOf(lesson);
  if (parts.explain.flat().length === 0) {
    problems.push({ line: null, where: "lesson", text: "", reason: "the lesson explains nothing before its example" });
    return problems;
  }

  for (const l of all) {
    if (l.kind === "untagged") lineProblem(l, "it has no tag; every line must start with [Pn], [teach], [define: term], [line n] or [close]");
    if (URL_IN_TEXT.test(l.text)) lineProblem(l, "it contains a link");
    if (l.text.includes("```")) lineProblem(l, "code belongs in the EXAMPLE, never in a sentence");
  }
  for (const m of parts.misplaced) lineProblem(m.line, m.why);

  // A line ending in ":" must be followed by an example block (Udit: a code
  // rule, not a judge rule). Only the last EXPLAIN line can be.
  const explainLines = parts.explain.flat();
  const lastExplain = explainLines[explainLines.length - 1];
  const exampleFollows = lesson.items.some((x) => x.type === "example");
  for (const l of all) {
    if (!/:\s*$/.test(l.text)) continue;
    if (l === lastExplain && exampleFollows) continue;
    lineProblem(l, "it ends with ':' but no example block follows it");
  }

  const defines = all.filter((l) => l.kind === "define");
  for (const l of defines.slice(MAX_DEFINE_LINES)) {
    lineProblem(l, `at most ${MAX_DEFINE_LINES} [define] lines; cite a passage here or explain with a [teach] line`);
  }
  if (parts.close === null && !parts.misplaced.some((m) => m.line.kind === "close")) {
    problems.push({ line: null, where: "close", text: "", reason: "the lesson has no closing line" });
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
 * unverified is shown in its place (decision 2). EXAMPLE must name a code
 * passage of the main source; OUTPUT must name the code block that comes
 * RIGHT AFTER the example's block on the same page, or any other code would
 * be shown to a beginner as "Expected output".
 */
export function settleExample(lesson: DraftLesson, passages: Passage[], mainSource: number): DraftLesson {
  const index = lesson.items.findIndex((x) => x.type === "example");
  if (index === -1) return lesson;
  const ex = lesson.items[index] as Extract<LessonItem, { type: "example" }>;
  const code = (id: number | null) => (id === null ? undefined : passages.find((p) => p.id === id && p.kind === "code"));
  const example = code(ex.passage);
  if (!example || example.source !== mainSource) {
    const items = lesson.items.filter((_, i) => i !== index);
    const why = example ? "not from the main source" : "not a code passage";
    return { ...lesson, items, dropped: [...lesson.dropped, `EXAMPLE [P${ex.passage}] (${why})`] };
  }
  if (ex.output === null) return lesson;
  const output = code(ex.output);
  const why =
    ex.output === ex.passage
      ? "the example already shows it"
      : !output
        ? "not a code passage"
        : output.source !== example.source || example.block === undefined || output.block !== example.block + 1
          ? "not the code block right after the example on its page"
          : null;
  if (why === null) return lesson;
  const items = lesson.items.map((x, i) => (i === index ? { ...ex, output: null } : x));
  return { ...lesson, items, dropped: [...lesson.dropped, `OUTPUT [P${ex.output}] (${why})`] };
}

// ─── the fix turn ──────────────────────────────────────────────────────────

export interface FixAnswer {
  /** Replacement lines by the line number they replace; null means DROP. */
  lines: Map<number, Line | null>;
  title: string | null;
  summary: string | null;
  /** New lines, placed by kind (applyFix). */
  added: Line[];
  /** An EXAMPLE the lesson lacked. */
  example: number | null;
}

/** Read the fix turn's answer: "L4: [P3] → …", "L4: DROP", "ADD: [line 5] → …", "EXAMPLE [P6]", "TITLE: …". */
export function parseFixAnswer(content: string): FixAnswer {
  const out: FixAnswer = { lines: new Map(), title: null, summary: null, added: [], example: null };
  for (const raw of content.replace(/\r\n/g, "\n").split("\n")) {
    const text = raw.trim();
    const l = /^L(\d{1,3})\s*[:.)-]\s*(.+)$/i.exec(text);
    if (l) {
      const n = Number(l[1]);
      if (out.lines.has(n)) continue;
      if (/^DROP\b/i.test(l[2].trim())) out.lines.set(n, null);
      else {
        const parsed = parseLine(l[2]);
        if (parsed) out.lines.set(n, parsed);
      }
      continue;
    }
    const add = /^ADD\s*[:.)-]\s*(.+)$/i.exec(text);
    if (add) {
      const parsed = parseLine(add[1]);
      if (parsed && parsed.kind !== "untagged") out.added.push(parsed);
      continue;
    }
    const ex = EXAMPLE_RE.exec(text);
    if (ex && out.example === null) out.example = Number(ex[1]);
    const title = /^TITLE\s*:\s*(.+)$/i.exec(text);
    if (title) out.title = clean(title[1]);
    const summary = /^SUMMARY\s*:\s*(.+)$/i.exec(text);
    if (summary) out.summary = clean(summary[1]);
  }
  return out;
}

/**
 * Splice a fix answer into the draft. A replaced line stays where it was (a
 * DROP removes it); an added walk-through line goes into the walk-through in
 * code-line order; an added closing line goes last; an added definition goes
 * just before the first line that uses its term (`termOf` names the term a
 * line defines); any other added line ends EXPLAIN, before a closing ':' line.
 * Returns the new lesson, the lines that are new (the only ones judged
 * again) and the asked-for lines the answer did not mention.
 */
export function applyFix(
  lesson: DraftLesson,
  fix: FixAnswer,
  asked: number[],
  termOf: (l: Line) => string | null = (l) => l.term
): { lesson: DraftLesson; changed: Line[]; missing: number[] } {
  const changed: Line[] = [];
  let n = 0;
  let items: LessonItem[] = [];
  for (const item of lesson.items) {
    if (item.type !== "line") {
      items.push(item);
      continue;
    }
    n += 1;
    if (!asked.includes(n) || !fix.lines.has(n)) {
      items.push(item);
      continue;
    }
    const r = fix.lines.get(n);
    if (r) {
      changed.push(r);
      items.push({ type: "line", line: r });
    }
  }

  if (fix.example !== null && !items.some((x) => x.type === "example")) {
    // After the last EXPLAIN line: before any walk-through or closing line.
    const firstAfter = items.findIndex((x) => x.type === "line" && (x.line.kind === "walk" || x.line.kind === "close"));
    const at = firstAfter === -1 ? items.length : firstAfter;
    items = [...items.slice(0, at), { type: "example", passage: fix.example, output: null }, ...items.slice(at)];
  }

  for (const add of fix.added) {
    changed.push(add);
    const item: LessonItem = { type: "line", line: add };
    if (add.kind === "close") {
      if (!items.some((x) => x.type === "line" && x.line.kind === "close")) items.push(item);
      else changed.pop();
      continue;
    }
    if (add.kind === "walk") {
      const exampleAt = items.findIndex((x) => x.type === "example");
      if (exampleAt === -1) {
        changed.pop();
        continue;
      }
      // Past the walk-through lines that explain earlier (or the same) code lines.
      const start = add.codeLines?.[0] ?? 0;
      let at = exampleAt + 1;
      while (at < items.length) {
        const x = items[at];
        if (x.type === "break") at++;
        else if (x.type === "line" && x.line.kind === "walk" && (x.line.codeLines?.[0] ?? 0) <= start) at++;
        else break;
      }
      items = [...items.slice(0, at), item, ...items.slice(at)];
      continue;
    }
    const explainEnd = (() => {
      const ex = items.findIndex((x) => x.type === "example" || (x.type === "line" && (x.line.kind === "walk" || x.line.kind === "close")));
      return ex === -1 ? items.length : ex;
    })();
    const term = termOf(add);
    if (term) {
      const uses = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
      const first = items.findIndex((x, i) => i < explainEnd && x.type === "line" && uses.test(x.line.text));
      const at = first === -1 ? 0 : first;
      items = [...items.slice(0, at), item, ...items.slice(at)];
      continue;
    }
    // End of EXPLAIN — but before a last line that introduces the example.
    let at = explainEnd;
    while (at > 0 && items[at - 1].type === "break") at--;
    const prev = items[at - 1];
    if (prev && prev.type === "line" && /:\s*$/.test(prev.line.text)) at -= 1;
    items = [...items.slice(0, at), item, ...items.slice(at)];
  }

  const next: DraftLesson = {
    ...lesson,
    title: fix.title ?? lesson.title,
    summary: fix.summary ?? lesson.summary,
    items,
  };
  return { lesson: next, changed, missing: asked.filter((a) => !fix.lines.has(a)) };
}

// ─── rendering ─────────────────────────────────────────────────────────────

/** EXPLAIN shown as 2-4 short paragraphs, whatever breaks the writer used. */
export function explainParagraphs(explain: Line[][]): Line[][] {
  const lines = explain.flat();
  if (lines.length <= 1) return lines.length ? [lines] : [];
  if (explain.length >= 2 && explain.length <= 4 && explain.every((p) => p.length <= 6)) return explain;
  const k = Math.min(4, Math.max(2, Math.round(lines.length / 4)));
  const size = Math.ceil(lines.length / k);
  const out: Line[][] = [];
  for (let i = 0; i < lines.length; i += size) out.push(lines.slice(i, i + size));
  return out;
}

/** The example's code lines a walk-through line explains, as inline code. */
function codePrefix(code: string, range: [number, number] | null): string {
  if (!range) return "";
  const shown = code
    .split("\n")
    .slice(range[0] - 1, range[1])
    .map((l) => l.trim().replace(/`/g, "'"))
    .filter(Boolean)
    .map((l) => `\`${l}\``);
  return shown.length ? `${shown.join(" ")} — ` : "";
}

/**
 * The stored lesson body, as lib/markdown-blocks.ts reads it: EXPLAIN
 * paragraphs, the example (the passage's own lines) and its output, the
 * walk-through as a list led by the code it explains, then the closing line.
 */
export function renderLessonMarkdown(lesson: DraftLesson, passages: Passage[]): string {
  const out: string[] = [];
  const parts = partsOf(lesson);
  const sentence = (l: Line) => (l.kind === "define" ? `${l.text} *${NOT_FROM_SOURCE}*` : l.text);
  for (const p of explainParagraphs(parts.explain)) out.push(p.map(sentence).join(" "));
  const ex = exampleOf(lesson);
  const code = (id: number | null) => (id === null ? null : passages.find((p) => p.id === id && p.kind === "code") ?? null);
  const example = ex ? code(ex.passage) : null;
  if (example) {
    out.push("```python\n" + example.text + "\n```");
    const output = ex ? code(ex.output) : null;
    if (output) {
      out.push("Expected output:");
      out.push("```text\n" + output.text + "\n```");
    }
    if (parts.walk.length) out.push(parts.walk.map((w) => `- ${codePrefix(example.text, w.codeLines)}${w.text}`).join("\n"));
  }
  if (parts.close) out.push(parts.close.text);
  return out.join("\n\n");
}

/** Reading time for the "n MIN READ" line: 200 words a minute, at least 1. */
export function minutesToRead(markdown: string): number {
  const prose = markdown.replace(/```[\s\S]*?```/g, " ");
  return Math.max(1, Math.round(words(prose) / 200));
}
