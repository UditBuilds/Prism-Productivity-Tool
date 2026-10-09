import {
  LESSON_MAX_WORDS,
  LESSON_MIN_WORDS,
} from "@/lib/learning/constants";
import { URL_IN_TEXT } from "@/lib/learning/sources";

/**
 * The lesson as the writer returns it, and the rules checked in CODE rather
 * than trusted to the prompt. Pure.
 *
 * The writer does not return Markdown. It returns structured blocks in which
 * every sentence carries the source number and the exact words it rests on
 * (`support`). That structure is what makes the grounding check
 * (grounding.ts) possible, and it also makes two of decision 11's rules hold
 * by construction: there is ONE optional `example` field, so a lesson cannot
 * carry three code blocks (2 of 3 probe lessons did when the rule lived only in
 * the prompt), and an example cannot be stored without its expected output.
 * The stored `body` is Markdown rendered from this structure.
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
}

export class LessonFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LessonFormatError";
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

function parseSupport(v: unknown): Support[] {
  if (!Array.isArray(v)) return [];
  const out: Support[] = [];
  for (const raw of v.slice(0, 3)) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const source = typeof r.source === "number" ? r.source : Number(r.source);
    const quote = str(r.quote);
    if (Number.isInteger(source) && quote) out.push({ source, quote });
  }
  return out;
}

function parseClaims(v: unknown): Claim[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((raw) => {
      if (typeof raw !== "object" || raw === null) return null;
      const r = raw as Record<string, unknown>;
      const text = str(r.text);
      return text ? { text, support: parseSupport(r.support) } : null;
    })
    .filter((c): c is Claim => c !== null);
}

/** Parse the writer's JSON into a DraftLesson. Throws on a broken shape. */
export function parseDraftLesson(content: string): DraftLesson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new LessonFormatError("The AI returned a lesson that was not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new LessonFormatError("The AI returned an empty lesson.");
  }
  const p = parsed as Record<string, unknown>;
  const blocks: LessonBlock[] = [];
  for (const raw of Array.isArray(p.blocks) ? p.blocks : []) {
    if (typeof raw !== "object" || raw === null) continue;
    const b = raw as Record<string, unknown>;
    if (b.type === "heading") {
      const text = str(b.text).replace(/^#+\s*/, "");
      if (text) blocks.push({ type: "heading", text });
    } else if (b.type === "paragraph") {
      const sentences = parseClaims(b.sentences);
      if (sentences.length) blocks.push({ type: "paragraph", sentences });
    } else if (b.type === "list") {
      const items = parseClaims(b.items);
      if (items.length) blocks.push({ type: "list", items });
    }
  }

  let example: LessonExample | null = null;
  if (typeof p.example === "object" && p.example !== null) {
    const e = p.example as Record<string, unknown>;
    const code = typeof e.code === "string" ? e.code.replace(/\r\n/g, "\n").replace(/^\n+|\s+$/g, "") : "";
    const output = typeof e.output === "string" ? e.output.replace(/\r\n/g, "\n").replace(/^\n+|\s+$/g, "") : "";
    const afterBlock = Number(e.after_block ?? e.afterBlock);
    if (code) {
      example = {
        code,
        output,
        afterBlock: Number.isInteger(afterBlock) ? afterBlock : blocks.length - 1,
        support: parseSupport(e.support),
      };
    }
  }

  return { title: str(p.title), summary: str(p.summary), blocks, example };
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
  if (!lesson.title || lesson.title.length > 90) problems.push("the title must be 1 to 90 characters");
  if (!lesson.summary || lesson.summary.length > 200) problems.push("the summary must be one sentence under 200 characters");
  if (lesson.blocks.filter((b) => b.type !== "heading").length < 2) problems.push("the lesson needs at least two paragraphs");

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
    else if (b.type === "paragraph") out.push(b.sentences.map((s) => s.text).join(" "));
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
