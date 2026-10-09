import {
  LESSON_MAX_WORDS,
  LESSON_MIN_WORDS,
} from "@/lib/learning/constants";
import { URL_IN_TEXT } from "@/lib/learning/sources";

/**
 * The lesson as the writer returns it, and the rules checked in CODE rather
 * than trusted to the prompt. Pure.
 *
 * The writer does not return Markdown and does not return JSON. It returns a
 * line format in which every sentence carries the number of a source and the
 * exact words it rests on:
 *
 *   TITLE: What a list is
 *   SUMMARY: A list keeps many values in order, in one variable.
 *   ## Making a list
 *   [1] «A list holds many values in order» → A list keeps many values, in order.
 *   - [2] «indexes start at 0» → The first item is at position 0.
 *   EXAMPLE [2] «fruits = ["apple", "pear"]»
 *   ```python
 *   ...
 *   ```
 *   OUTPUT
 *   ```text
 *   ...
 *   ```
 *
 * Why not JSON: measured 2026-10-09, 3 of 9 nested-JSON drafts were refused
 * by Groq's JSON mode ("Failed to validate JSON", HTTP 400) — quotes copied
 * from web pages are full of double quotes, and one structural slip loses
 * the whole lesson. A line that does not parse here is reported and the rest
 * survives.
 *
 * The structure is what makes the grounding check (grounding.ts) possible,
 * and it also makes two of decision 11's rules hold by construction: only one
 * EXAMPLE is read, so a lesson cannot carry three code blocks (2 of 3 probe
 * lessons did when the rule lived only in the prompt), and an example cannot
 * be stored without its expected output. The stored `body` is Markdown
 * rendered from this structure.
 */

export interface Support {
  source: number;
  quote: string;
}

export interface Claim {
  text: string;
  support: Support[];
}

export type LessonBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; sentences: Claim[] }
  | { type: "list"; items: Claim[] };

export interface LessonExample {
  /** Index into `blocks`: the example is shown after that block. */
  afterBlock: number;
  code: string;
  output: string;
  support: Support[];
}

export interface DraftLesson {
  title: string;
  summary: string;
  blocks: LessonBlock[];
  example: LessonExample | null;
  /** Non-empty lines that were not in the format — reported, never shown. */
  unparsed: string[];
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

/**
 * `[source 2] «quote»` pairs. The word "source" is asked for because a bare
 * `[2]` was read by the model as a LINE number: measured 2026-10-09, a draft
 * with 21 one-line paragraphs cited "source 21" and "source 16" when it had
 * been given 3. `[S2]` and a bare `[2]` are still read. “quote” and "quote"
 * are accepted as delimiters as well as «quote».
 */
const SOURCE_TAG = String.raw`\[\s*(?:source\s*|s\s*)?(\d{1,2})\s*\]`;
const QUOTE = String.raw`(?:«([^»]+)»|“([^”]+)”|"([^"]+)")`;
const SUPPORT_RE = new RegExp(`${SOURCE_TAG}\\s*${QUOTE}`, "gi");
const CLAIM_RE = new RegExp(
  String.raw`^(-\s+|\*\s+)?((?:\[\s*(?:source\s*|s\s*)?\d{1,2}\s*\]\s*(?:«[^»]+»|“[^”]+”|"[^"]+")\s*)+)(?:→|->|=>|—>)\s*(.+)$`,
  "i"
);

function supportsIn(s: string): Support[] {
  return Array.from(s.matchAll(SUPPORT_RE), (m) => ({
    source: Number(m[1]),
    quote: clean(m[2] ?? m[3] ?? m[4] ?? ""),
  }))
    .filter((x) => Number.isInteger(x.source) && x.quote)
    .slice(0, 3);
}

function fence(lines: string[], from: number): { body: string; next: number } | null {
  let i = from;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i >= lines.length || !lines[i].trim().startsWith("```")) return null;
  const body: string[] = [];
  i++;
  while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
  return { body: body.join("\n").replace(/^\n+|\s+$/g, ""), next: i + 1 };
}

/** Parse the writer's answer. Throws only when nothing usable came back. */
export function parseDraftLesson(content: string): DraftLesson {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const lesson: DraftLesson = { title: "", summary: "", blocks: [], example: null, unparsed: [] };
  let open: { type: "paragraph"; sentences: Claim[] } | { type: "list"; items: Claim[] } | null = null;
  const close = () => {
    if (open) lesson.blocks.push(open);
    open = null;
  };

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
    if (/^EXAMPLE\b/i.test(line)) {
      close();
      const code = fence(lines, i + 1);
      if (!code) {
        lesson.unparsed.push(line);
        continue;
      }
      i = code.next - 1;
      let output = "";
      let j = code.next;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && /^OUTPUT\b/i.test(lines[j].trim())) {
        const out = fence(lines, j + 1);
        if (out) {
          output = out.body;
          i = out.next - 1;
        }
      }
      // Only the first example is kept: one example per lesson, by construction.
      if (!lesson.example && code.body) {
        lesson.example = {
          code: code.body,
          output,
          afterBlock: lesson.blocks.length - 1,
          support: supportsIn(line),
        };
      }
      continue;
    }
    if (line.startsWith("```")) {
      // A stray code block outside EXAMPLE: skip it whole, and say so.
      const stray = fence(lines, i);
      lesson.unparsed.push("a code block outside EXAMPLE");
      if (stray) i = stray.next - 1;
      continue;
    }
    const claim = CLAIM_RE.exec(line);
    if (claim) {
      const isItem = Boolean(claim[1]);
      const c: Claim = { text: clean(claim[3]), support: supportsIn(claim[2]) };
      if (!c.text) continue;
      if (isItem) {
        if (!open || open.type !== "list") {
          close();
          open = { type: "list", items: [] };
        }
        open.items.push(c);
      } else {
        if (!open || open.type !== "paragraph") {
          close();
          open = { type: "paragraph", sentences: [] };
        }
        open.sentences.push(c);
      }
      continue;
    }
    lesson.unparsed.push(line.slice(0, 120));
  }
  close();

  if (!lesson.title && lesson.blocks.length === 0) {
    throw new LessonFormatError("The AI's answer was not in the lesson format.");
  }
  return lesson;
}

/** Every claim in reading order. */
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

export const MAX_EXAMPLE_LINES = 12;

/**
 * Decision 11's mechanical rules. Returns human-readable problems; empty
 * means the lesson's form is acceptable (its grounding is checked separately).
 */
export function checkLessonRules(lesson: DraftLesson): string[] {
  const problems: string[] = [];
  if (lesson.unparsed.length > 0) {
    problems.push(
      `${lesson.unparsed.length} line${lesson.unparsed.length === 1 ? " was" : "s were"} not in the format; every sentence must be [source n] «exact quote» → sentence`
    );
  }
  if (!lesson.title || lesson.title.length > 90) problems.push("the title must be 1 to 90 characters");
  if (!lesson.summary || lesson.summary.length > 200) problems.push("the summary must be one sentence under 200 characters");
  // No "at least two paragraphs" rule: it rejected 4 of 7 drafts on
  // 2026-10-09 for layout alone. Long paragraphs are split when rendered.
  if (lesson.blocks.filter((b) => b.type !== "heading").length < 1) problems.push("the lesson has no sentences");

  const count = proseWordCount(lesson);
  if (count < LESSON_MIN_WORDS || count > LESSON_MAX_WORDS) {
    problems.push(`the lesson is ${count} words; it must be ${LESSON_MIN_WORDS} to ${LESSON_MAX_WORDS}`);
  }

  const texts = [
    lesson.title,
    lesson.summary,
    ...lesson.blocks.map((b) => (b.type === "heading" ? b.text : "")),
    ...claimsOf(lesson).map((c) => c.text),
  ];
  if (texts.some((t) => URL_IN_TEXT.test(t))) problems.push("the lesson must not contain links; refer to sources by number");
  if (texts.some((t) => t.includes("```"))) problems.push("code belongs in the example field, not in sentences");

  if (lesson.example) {
    const lines = lesson.example.code.split("\n").length;
    if (lines > MAX_EXAMPLE_LINES) problems.push(`the example is ${lines} lines; keep it to ${MAX_EXAMPLE_LINES}`);
    if (!lesson.example.output) problems.push("the example must show its expected output");
    if (lesson.example.code.includes("```") || lesson.example.output.includes("```")) {
      problems.push("the example must not contain code fences");
    }
  }
  return problems;
}

/** Sentences per displayed paragraph before a long one is split. */
export const PARAGRAPH_SENTENCES = 5;

/** The stored lesson body. One line per paragraph, as lib/markdown-blocks.ts reads it. */
export function renderLessonMarkdown(lesson: DraftLesson): string {
  const out: string[] = [];
  const pushExample = () => {
    if (!lesson.example) return;
    out.push("```python\n" + lesson.example.code + "\n```");
    out.push("Expected output:");
    out.push("```text\n" + lesson.example.output + "\n```");
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
    }
    else out.push(b.items.map((it) => `- ${it.text}`).join("\n"));
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
