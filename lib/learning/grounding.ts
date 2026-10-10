import { claimsOf, type Claim, type DraftLesson, type LessonProblem } from "@/lib/learning/lesson-format";
import type { Passage } from "@/lib/learning/passages";

/**
 * The free rules of the "tied to its sources" check. Pure and deterministic:
 * no AI call, so it costs nothing and gives the same answer every time. The
 * meaning check (judge.ts) runs only on drafts these rules accept.
 *
 * Every passage the writer can cite was already found word for word in its
 * page (passages.ts), so this file does not look for quotes. It checks what
 * each line may SAY:
 *
 *   [Pn] lines — every number, `code span`, API token (print(), np.array,
 *   my_var) and capitalised name in the sentence must be in the passages it
 *   cites (or the lesson's example). A name may also come from the topic and
 *   step titles or any of the pages the lesson was given (Udit's decision,
 *   2026-10-09: all 14 names the stricter rule flagged were in the sources).
 *
 *   [teach] lines (decision 1, 2026-10-10) — cite nothing, so they may add
 *   NOTHING: every number, code span, API token and name in them must already
 *   be in a passage this lesson cites, or its example. Not "any page": a
 *   teach line that names something no cited passage mentions is adding a
 *   name. Whether a teach line slips in a new CLAIM in plain words is a
 *   question of meaning, which the judge answers.
 *
 *   The example — must be a code passage (so it is code a source shows), and
 *   its output, if any, another code passage (decision 2).
 *
 *   Title, summary and headings — their numbers must be in a cited passage;
 *   the summary's names in the passages, titles or pages.
 */

export interface GroundingContext {
  topicTitle: string;
  stepTitle: string;
  /** The page excerpts the lesson was made from: where a [Pn] line's names may also come from. */
  sourceTexts: string[];
}

/** Lower-case, one space, no quote marks, plain dashes, no Markdown emphasis. */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[*_]/g, "")
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  const out = (normalize(s).match(/[a-z0-9][a-z0-9+#'.-]*/g) ?? [])
    .map((t) => t.replace(/'s$/, "").replace(/[.'-]+$/, ""))
    .filter((t) => t.length > 0);
  // "np.array" also counts as "np" and "array".
  return out.flatMap((t) => (/[.-]/.test(t) ? [t, ...t.split(/[.-]/).filter(Boolean)] : [t]));
}

/**
 * Every number in a string, commas dropped. Numbers glued to letters
 * ("python3", "h1") are part of a word, not a figure.
 *
 * No lookbehind anywhere in this file: Safari before 16.4 cannot parse one,
 * and a regex literal it cannot parse breaks the whole bundle chunk.
 */
function numbersIn(s: string): string[] {
  return Array.from(s.matchAll(/(^|[^A-Za-z0-9.])(\d[\d,]*(?:\.\d+)?)/g), (m) =>
    m[2].replace(/,/g, "").replace(/\.$/, "")
  );
}

/** Numbers, `code spans`, API tokens and capitalised names in a sentence. */
export function specificsOf(text: string): { numbers: string[]; code: string[]; api: string[]; names: string[] } {
  const code = Array.from(text.matchAll(/`([^`]+)`/g), (m) => m[1].trim()).filter(Boolean);
  const plain = text.replace(/`[^`]*`/g, " ");
  const numbers = numbersIn(plain);
  // API details outside backticks: a call (print(), type(x)), a dotted name
  // (np.array) or a snake_case name (my_var). "e.g." is not one.
  const api = Array.from(
    new Set([
      ...Array.from(plain.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\(/g), (m) => m[1]),
      ...Array.from(plain.matchAll(/\b([A-Za-z_][A-Za-z0-9_]+(?:\.[A-Za-z_][A-Za-z0-9_]+)+)\b/g), (m) => m[1]),
      ...Array.from(plain.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g), (m) => m[1]),
    ])
  );
  const names: string[] = [];
  // Sentence-initial words and words after ": " are capitalised by grammar,
  // not because they are names.
  const sentences = plain.replace(/([.!?:])\s+/g, "$1\u0000").split("\u0000");
  for (const sentence of sentences) {
    const ws = sentence.replace(/^[^A-Za-z0-9]+/, "").split(/\s+/);
    ws.slice(1).forEach((raw) => {
      const w = raw.replace(/^[^A-Za-z]+|[^A-Za-z0-9]+$/g, "");
      if (/^[A-Z][A-Za-z0-9]+$/.test(w) && w !== "I") names.push(w);
    });
  }
  return { numbers, code, api, names };
}

function codeNorm(s: string): string {
  return normalize(s).replace(/\(\)$/, "");
}

interface Evidence {
  text: string;
  numbers: Set<string>;
  tokens: Set<string>;
}

function evidenceOf(texts: string[]): Evidence {
  const text = normalize(texts.join("\n"));
  return { text, numbers: new Set(numbersIn(texts.join("\n"))), tokens: new Set(tokens(texts.join("\n"))) };
}

/** What a line says that its evidence does not contain. */
function unsupported(
  text: string,
  evidence: Evidence,
  extraNames: Set<string>
): string[] {
  const out: string[] = [];
  const { numbers, code, api, names } = specificsOf(text);
  for (const n of numbers) if (!evidence.numbers.has(n)) out.push(`the number ${n}`);
  for (const c of code) {
    const needle = codeNorm(c);
    if (needle && !evidence.text.includes(needle)) out.push(`\`${c}\``);
  }
  for (const a of api) {
    const parts = normalize(a).split(".");
    if (!evidence.tokens.has(normalize(a)) && !evidence.tokens.has(parts[parts.length - 1])) out.push(`${a}`);
  }
  for (const name of names) {
    const lower = name.toLowerCase();
    if (!evidence.tokens.has(lower) && !extraNames.has(lower)) out.push(`the name "${name}"`);
  }
  return out;
}

function list(items: string[]): string {
  return items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Run every free rule. An empty list means the lesson may go to the meaning check. */
export function checkGrounding(lesson: DraftLesson, passages: Passage[], ctx: GroundingContext): LessonProblem[] {
  const problems: LessonProblem[] = [];
  const byId = new Map(passages.map((p) => [p.id, p]));
  const claims = claimsOf(lesson);

  // The example: a code passage, and its output another code passage.
  const exampleTexts: string[] = [];
  if (lesson.example) {
    const ex = byId.get(lesson.example.passage);
    if (!ex || ex.kind !== "code") {
      problems.push({
        line: null,
        where: "example",
        text: `EXAMPLE [P${lesson.example.passage}]`,
        reason: ex ? `P${ex.id} is not a code passage` : `there is no passage P${lesson.example.passage}`,
      });
    } else exampleTexts.push(ex.text);
    if (lesson.example.output !== null) {
      const out = byId.get(lesson.example.output);
      if (!out || out.kind !== "code") {
        problems.push({
          line: null,
          where: "example",
          text: `OUTPUT [P${lesson.example.output}]`,
          reason: out ? `P${out.id} is not a code passage, so it does not show output` : `there is no passage P${lesson.example.output}`,
        });
      } else exampleTexts.push(out.text);
    }
  }

  const citedIds = new Set(claims.flatMap((c) => (c.teach || c.untagged ? [] : c.cites)));
  const lessonEvidence = evidenceOf([
    ...Array.from(citedIds).flatMap((id) => (byId.has(id) ? [byId.get(id)!.text] : [])),
    ...exampleTexts,
  ]);
  const titleNames = new Set(tokens(`${ctx.topicTitle} ${ctx.stepTitle}`));
  const pageNames = new Set([...Array.from(titleNames), ...tokens(ctx.sourceTexts.join("\n"))]);

  claims.forEach((c: Claim, i) => {
    const line = i + 1;
    const where = `line ${line}`;
    if (c.untagged) return; // already reported by checkLessonRules
    if (c.teach) {
      const extra = unsupported(c.text, lessonEvidence, titleNames);
      if (extra.length > 0) {
        problems.push({
          line,
          where,
          text: c.text,
          reason: `a [teach] line may add nothing, but it adds ${list(extra)}, which no passage this lesson cites contains`,
        });
      }
      return;
    }
    const missing = c.cites.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      problems.push({ line, where, text: c.text, reason: `it cites ${missing.map((m) => `P${m}`).join(", ")}, which it was not given` });
      return;
    }
    const evidence = evidenceOf([...c.cites.map((id) => byId.get(id)!.text), ...exampleTexts]);
    const extra = unsupported(c.text, evidence, pageNames);
    if (extra.length > 0) {
      problems.push({ line, where, text: c.text, reason: `${list(extra)} ${extra.length === 1 ? "is" : "are"} not in the passages it cites` });
    }
  });

  // Title, summary and headings cite nothing of their own.
  const framing: [string, string][] = [
    ["title", lesson.title],
    ["summary", lesson.summary],
    ...lesson.blocks
      .filter((b): b is { type: "heading"; text: string } => b.type === "heading")
      .map((b, i): [string, string] => [`heading ${i + 1}`, b.text]),
  ];
  for (const [where, text] of framing) {
    const { numbers, names } = specificsOf(text);
    for (const n of numbers) {
      if (!lessonEvidence.numbers.has(n)) {
        problems.push({ line: null, where, text, reason: `the number ${n} is in no passage this lesson cites` });
      }
    }
    // Titles and headings are written in Title Case, so a capital there is
    // not a name. Only the summary, a plain sentence, has its names checked.
    if (where !== "summary") continue;
    for (const name of names) {
      const lower = name.toLowerCase();
      if (!lessonEvidence.tokens.has(lower) && !pageNames.has(lower)) {
        problems.push({ line: null, where, text, reason: `the name "${name}" is not in the sources` });
      }
    }
  }
  return problems;
}
