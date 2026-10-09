import { claimsOf, type Claim, type DraftLesson, type Support } from "@/lib/learning/lesson-format";

/**
 * The "not tied to its sources" check. Pure and deterministic: no AI call, so
 * it costs nothing and gives the same answer every time.
 *
 * The writer must attach to EVERY sentence and list item the number of a
 * source and an exact quote from it (lesson-format.ts). A lesson passes only
 * if every one of these holds:
 *
 *   1. Every claim has at least one quote, naming a source it was given.
 *   2. Every quote is real: at least MIN_QUOTE_WORDS words, and found word for
 *      word in THAT source's text — the same excerpt the writer was shown —
 *      after normalising case, whitespace, curly quotes and dashes. "..."
 *      inside a quote splits it into pieces that must all be found, in order.
 *   3. The claim's specifics are in its evidence. Every number, every
 *      `code span` and every capitalised name in the sentence must appear in
 *      its quotes (code spans and numbers may also come from the lesson's own
 *      example, which sentences explain; names may also come from the topic
 *      and step titles).
 *   4. The claim says mostly what its quotes say: at least MIN_COVERAGE of
 *      the sentence's content words (stop words and teaching filler removed,
 *      crude stemming) appear in its quotes or the example.
 *   5. The example's called functions and imported modules appear somewhere
 *      in the sources, so an example cannot teach a function no source shows.
 *
 * What it cannot catch, stated plainly: a sentence that reuses its quote's
 * words but reverses or distorts their meaning ("a list holds only one value"
 * against "a list holds many values"), and a wrong expected output. Word
 * matching cannot read meaning; the PR reports the measured catch rate.
 */

export const MIN_QUOTE_WORDS = 4;
export const MIN_COVERAGE = 0.5;
/** Claims with fewer content words than this skip rule 4 ("Try it."). */
export const MIN_CONTENT_WORDS_FOR_COVERAGE = 3;

export interface GroundingSource {
  /** 1-based, as the writer saw it. */
  n: number;
  /** Exactly the excerpt the writer was given. */
  text: string;
}

export interface GroundingProblem {
  where: string;
  text: string;
  reason: string;
}

export interface GroundingContext {
  topicTitle: string;
  stepTitle: string;
}

/** Lower-case, one space, straight quotes, plain dashes, no Markdown emphasis. */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[*_]/g, "")
    .replace(/'(?=[^a-z]|$)|(^|[^a-z])'/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function stripEdgePunct(s: string): string {
  return s.replace(/^[\s"'.,;:!?()[\]-]+|[\s"',;:!?()[\]-]+$/g, "").replace(/\.$/, "");
}

/** True when `quote` occurs word for word in `haystack` (both normalised). */
export function quoteFound(quote: string, haystackNorm: string): boolean {
  const pieces = normalize(quote)
    .split(/\.\.\.+/)
    .map(stripEdgePunct)
    .filter((p) => p.length > 0);
  if (pieces.length === 0) return false;
  let from = 0;
  for (const piece of pieces) {
    const at = haystackNorm.indexOf(piece, from);
    if (at === -1) return false;
    from = at + piece.length;
  }
  return true;
}

function quoteWords(quote: string): number {
  return (normalize(quote).replace(/\.\.\.+/g, " ").match(/[a-z0-9][a-z0-9'+#-]*/g) ?? []).length;
}

const STOP = new Set(
  (
    "a an the and or but nor so yet if then than that this these those there here it its it's " +
    "is are was were be been being am do does did done doing have has had having can could " +
    "will would shall should may might must of in on at to for from by with about as into onto " +
    "over under up down out off again also just only very more most much many some any each " +
    "every all both few other such own same not no yes too what which who whom whose when where " +
    "why how i me my we us our you your he him his she her they them their one's let let's lets " +
    "like means mean meaning called call calls think thing things way ways use uses using used " +
    "make makes making made get gets got put puts see sees look looks example examples simply " +
    "simple easy basic idea ideas important lesson step steps learn learning now first next new " +
    "know need needs want wants try tells tell say says said give gives write writes written " +
    "type types typed run runs running word words part parts kind kinds lot even still often " +
    "usually always never instead because while within without between through before after"
  ).split(/\s+/)
);

function stem(w: string): string {
  let s = w.replace(/'s$/, "").replace(/[.'-]+$/, "");
  if (s.length > 4 && s.endsWith("ies")) s = s.slice(0, -3) + "y";
  else if (s.length > 4 && /(ches|shes|sses|xes|zes)$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith("ly")) s = s.slice(0, -2);
  return s;
}

function tokens(s: string, split = false): string[] {
  const out = (normalize(s).match(/[a-z0-9][a-z0-9+#_'.-]*/g) ?? [])
    .map((t) => t.replace(/'s$/, "").replace(/[.'-]+$/, ""))
    .filter((t) => t.length > 0);
  // Evidence side only: "np.array" also counts as "np" and "array", so a
  // sentence naming `array` is supported by a source that writes np.array.
  return split
    ? out.flatMap((t) => (/[.-]/.test(t) ? [t, ...t.split(/[.-]/).filter(Boolean)] : [t]))
    : out;
}

function contentStems(s: string, split = false): string[] {
  return tokens(s, split)
    .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d/.test(t))
    .map(stem);
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

/** Numbers, `code spans` and capitalised names in a sentence. */
export function specificsOf(text: string): { numbers: string[]; code: string[]; names: string[] } {
  const code = Array.from(text.matchAll(/`([^`]+)`/g), (m) => m[1].trim()).filter(Boolean);
  const plain = text.replace(/`[^`]*`/g, " ");
  const numbers = numbersIn(plain);
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
  return { numbers, code, names };
}

function codeNorm(s: string): string {
  return normalize(s).replace(/\(\)$/, "").replace(/\s+/g, " ");
}

function lessonCodeText(lesson: DraftLesson): string {
  return lesson.example ? normalize(`${lesson.example.code}\n${lesson.example.output}`) : "";
}

function checkSupports(
  supports: Support[],
  sources: Map<number, string>,
  where: string,
  text: string,
  problems: GroundingProblem[]
): string[] {
  const verified: string[] = [];
  if (supports.length === 0) {
    problems.push({ where, text, reason: "no quote from a source" });
    return verified;
  }
  for (const s of supports) {
    const hay = sources.get(s.source);
    if (hay === undefined) {
      problems.push({ where, text, reason: `cites source ${s.source}, which it was not given` });
      continue;
    }
    if (quoteWords(s.quote) < MIN_QUOTE_WORDS) {
      problems.push({ where, text, reason: `quote "${s.quote}" is shorter than ${MIN_QUOTE_WORDS} words` });
      continue;
    }
    if (!quoteFound(s.quote, hay)) {
      problems.push({ where, text, reason: `quote "${s.quote.slice(0, 80)}" is not in source ${s.source}` });
      continue;
    }
    verified.push(normalize(s.quote));
  }
  return verified;
}

function checkClaim(
  claim: Claim,
  where: string,
  sources: Map<number, string>,
  codeText: string,
  names: Set<string>,
  problems: GroundingProblem[]
): void {
  const before = problems.length;
  const quotes = checkSupports(claim.support, sources, where, claim.text, problems);
  if (problems.length > before || quotes.length === 0) return;

  const evidence = quotes.join(" ");
  const evidenceNumbers = new Set([...numbersIn(evidence), ...numbersIn(codeText)]);
  const evidenceTokens = new Set(tokens(evidence, true));
  const { numbers, code, names: properNames } = specificsOf(claim.text);
  for (const n of numbers) {
    if (!evidenceNumbers.has(n)) {
      problems.push({ where, text: claim.text, reason: `the number ${n} is not in its quote` });
    }
  }
  for (const c of code) {
    const needle = codeNorm(c);
    if (needle && !evidence.includes(needle) && !codeText.includes(needle)) {
      problems.push({ where, text: claim.text, reason: `\`${c}\` is not in its quote or the example` });
    }
  }
  for (const name of properNames) {
    const lower = name.toLowerCase();
    if (!evidenceTokens.has(lower) && !names.has(lower)) {
      problems.push({ where, text: claim.text, reason: `the name "${name}" is not in its quote` });
    }
  }

  const stems = contentStems(claim.text);
  if (stems.length >= MIN_CONTENT_WORDS_FOR_COVERAGE) {
    const have = new Set([...contentStems(evidence, true), ...contentStems(codeText, true)]);
    const hit = stems.filter((s) => have.has(s)).length;
    const coverage = hit / stems.length;
    if (coverage < MIN_COVERAGE) {
      problems.push({
        where,
        text: claim.text,
        reason: `only ${Math.round(coverage * 100)}% of its words are in its quote (needs ${Math.round(MIN_COVERAGE * 100)}%)`,
      });
    }
  }
}

const PY_BUILTIN_SYNTAX = new Set(["if", "for", "while", "return", "print"]);

/** Function names the example calls and modules it imports, minus its own definitions. */
export function exampleNames(code: string): string[] {
  const defined = new Set(
    Array.from(code.matchAll(/\b(?:def|class)\s+([A-Za-z_]\w*)/g), (m) => m[1].toLowerCase())
  );
  const called = Array.from(code.matchAll(/([A-Za-z_][\w.]*)\s*\(/g), (m) => {
    const parts = m[1].split(".");
    return parts[parts.length - 1].toLowerCase();
  });
  const imported = Array.from(code.matchAll(/^\s*(?:from\s+([\w.]+)\s+)?import\s+([\w.]+)/gm), (m) =>
    (m[1] ?? m[2]).split(".")[0].toLowerCase()
  );
  return Array.from(new Set([...called, ...imported])).filter(
    (n) => !defined.has(n) && !PY_BUILTIN_SYNTAX.has(n)
  );
}

/** Run every rule. An empty list means the lesson is tied to its sources. */
export function checkGrounding(
  lesson: DraftLesson,
  given: GroundingSource[],
  ctx: GroundingContext
): GroundingProblem[] {
  const problems: GroundingProblem[] = [];
  const sources = new Map(given.map((s) => [s.n, normalize(s.text)]));
  const allSourceText = Array.from(sources.values()).join(" ");
  const codeText = lessonCodeText(lesson);
  const names = new Set(tokens(`${ctx.topicTitle} ${ctx.stepTitle}`, true));
  const sourceTokens = new Set(tokens(allSourceText, true));

  let p = 0;
  let l = 0;
  for (const block of lesson.blocks) {
    if (block.type === "paragraph") {
      p += 1;
      block.sentences.forEach((c, i) =>
        checkClaim(c, `paragraph ${p}, sentence ${i + 1}`, sources, codeText, names, problems)
      );
    } else if (block.type === "list") {
      l += 1;
      block.items.forEach((c, i) =>
        checkClaim(c, `list ${l}, item ${i + 1}`, sources, codeText, names, problems)
      );
    }
  }

  // Title, summary and headings carry no quotes of their own; their names
  // and numbers must still come from somewhere in the lesson's evidence.
  const allEvidence = claimsOf(lesson)
    .flatMap((c) => c.support.map((s) => normalize(s.quote)))
    .join(" ");
  const allEvidenceNumbers = new Set([...numbersIn(allEvidence), ...numbersIn(codeText)]);
  const allEvidenceTokens = new Set(tokens(allEvidence, true));
  const framing: [string, string][] = [
    ["title", lesson.title],
    ["summary", lesson.summary],
    ...lesson.blocks
      .filter((b): b is { type: "heading"; text: string } => b.type === "heading")
      .map((b, i): [string, string] => [`heading ${i + 1}`, b.text]),
  ];
  for (const [where, text] of framing) {
    const { numbers, names: properNames } = specificsOf(text);
    for (const n of numbers) {
      if (!allEvidenceNumbers.has(n)) {
        problems.push({ where, text, reason: `the number ${n} is not in any quote` });
      }
    }
    for (const name of properNames) {
      const lower = name.toLowerCase();
      if (!allEvidenceTokens.has(lower) && !names.has(lower) && !sourceTokens.has(lower)) {
        problems.push({ where, text, reason: `the name "${name}" is not in the sources` });
      }
    }
  }

  if (lesson.example) {
    checkSupports(lesson.example.support, sources, "example", lesson.example.code.split("\n")[0], problems);
    for (const name of exampleNames(lesson.example.code)) {
      if (!sourceTokens.has(normalize(name))) {
        problems.push({ where: "example", text: lesson.example.code.split("\n")[0], reason: `the example uses ${name}(), which no source shows` });
      }
    }
  }
  return problems;
}
