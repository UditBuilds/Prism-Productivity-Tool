import { exampleOf, linesOf, partsOf, type DraftLesson, type Line, type LessonProblem } from "@/lib/learning/lesson-format";
import { definedBy, type Passage } from "@/lib/learning/passages";

/**
 * The free rules of the "tied to its sources" check. Pure and deterministic:
 * no AI call, so it costs nothing and gives the same answer every time. The
 * meaning check (judge.ts) runs only on drafts these rules accept.
 *
 * Every passage the writer can cite was already found word for word in its
 * page (passages.ts), so this file does not look for quotes. It checks what
 * each line may SAY — numbers, `code spans`, API tokens (print(), np.array,
 * my_var) and capitalised names:
 *
 *   [Pn]       in the passages it cites (or the example's code). A name may
 *              also come from the topic and step titles or the lesson's
 *              source pages (Udit, 2026-10-09). Every cited passage comes
 *              from the main source, unless it is a definition (Udit,
 *              2026-10-10: a second source only for a definition).
 *   [teach]    adds NOTHING: only what the passages this lesson cites, or its
 *              example, already hold. No count limit (Udit, 2026-10-10).
 *   [define]   only for a term no passage defines; names its term; no
 *              numbers, and no code, API or other names beyond the term.
 *   [line n]   only what those lines of the example show: its numbers, code
 *              and API tokens must be in the code lines it explains.
 *   [close]    only what the lesson already said: its specifics must appear
 *              in the lines before it.
 *
 * And the lesson's shape against its passages: an EXAMPLE when the main
 * source shows code, every line of that code walked through in order, and
 * every key term the lesson uses defined (by a cited passage or a [define]
 * line). Whether a line's MEANING is supported is the judge's question.
 */

export interface GroundingContext {
  topicTitle: string;
  stepTitle: string;
  /** The page texts the lesson was made from: where a [Pn] line's names may also come from. */
  sourceTexts: string[];
  /** The page every cited passage and the example must come from. */
  mainSource: number;
  /** The key terms the copier named for this step (lower case). */
  terms: string[];
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
  const joined = texts.join("\n");
  return { text: normalize(joined), numbers: new Set(numbersIn(joined)), tokens: new Set(tokens(joined)) };
}

/** What a line says that its evidence does not contain. */
function unsupported(text: string, evidence: Evidence, extraNames: Set<string>): string[] {
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

/** Does the text use the term? Singular and plural are one term ("variable", "variables"). */
export function mentions(text: string, term: string): boolean {
  const t = term.toLowerCase().trim();
  if (!t) return false;
  const stem = t.endsWith("ies") ? t.slice(0, -3) : t.endsWith("y") ? t.slice(0, -1) : t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t;
  const tail = t.endsWith("y") || t.endsWith("ies") ? "(?:y|ies)" : "(?:s|es)?";
  const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}${tail}($|[^a-z0-9])`, "i").test(text);
}

/** Run every free rule. An empty list means the lesson may go to the meaning check. */
export function checkGrounding(lesson: DraftLesson, passages: Passage[], ctx: GroundingContext): LessonProblem[] {
  const problems: LessonProblem[] = [];
  const byId = new Map(passages.map((p) => [p.id, p]));
  const all = linesOf(lesson);
  const at = (l: Line) => all.indexOf(l) + 1;
  const lineProblem = (l: Line, reason: string) => problems.push({ line: at(l), where: `line ${at(l)}`, text: l.text, reason });
  const parts = partsOf(lesson);

  // The example: a code passage from the main source, when the source has one.
  const ex = exampleOf(lesson);
  const codePassages = passages.filter((p) => p.kind === "code" && p.source === ctx.mainSource);
  const example = ex ? byId.get(ex.passage) : undefined;
  const exampleTexts: string[] = [];
  if (!ex && codePassages.length > 0) {
    problems.push({
      line: null,
      where: "example",
      text: "",
      reason: `the lesson has no EXAMPLE; the source shows code (${codePassages.map((p) => `P${p.id}`).join(", ")})`,
    });
  } else if (ex && (!example || example.kind !== "code" || example.source !== ctx.mainSource)) {
    problems.push({ line: null, where: "example", text: `EXAMPLE [P${ex.passage}]`, reason: "the EXAMPLE must be a code passage from the main source" });
  } else if (example) {
    exampleTexts.push(example.text);
    const output = ex && ex.output !== null ? byId.get(ex.output) : undefined;
    if (output) exampleTexts.push(output.text);
  }
  const codeLines = example?.text.split("\n") ?? [];

  const cited = all.filter((l) => l.kind === "cited");
  const lessonEvidence = evidenceOf([
    ...Array.from(new Set(cited.flatMap((l) => l.cites))).flatMap((id) => (byId.has(id) ? [byId.get(id)!.text] : [])),
    ...exampleTexts,
  ]);
  const titleNames = new Set(tokens(`${ctx.topicTitle} ${ctx.stepTitle}`));
  const pageNames = new Set([...Array.from(titleNames), ...tokens(ctx.sourceTexts.join("\n"))]);

  all.forEach((l, i) => {
    switch (l.kind) {
      case "cited": {
        const missing = l.cites.filter((id) => !byId.has(id));
        if (missing.length > 0) {
          lineProblem(l, `it cites ${missing.map((m) => `P${m}`).join(", ")}, which it was not given`);
          return;
        }
        const second = l.cites.filter((id) => byId.get(id)!.source !== ctx.mainSource && !byId.get(id)!.defines);
        if (second.length > 0) {
          lineProblem(l, `it cites ${second.map((m) => `P${m}`).join(", ")} from a second source, which may only be used for a definition`);
          return;
        }
        const extra = unsupported(l.text, evidenceOf([...l.cites.map((id) => byId.get(id)!.text), ...exampleTexts]), pageNames);
        if (extra.length > 0) lineProblem(l, `${list(extra)} ${extra.length === 1 ? "is" : "are"} not in the passages it cites`);
        return;
      }
      case "teach": {
        const extra = unsupported(l.text, lessonEvidence, titleNames);
        if (extra.length > 0) {
          lineProblem(l, `a [teach] line may add nothing, but it adds ${list(extra)}, which no passage this lesson cites contains`);
        }
        return;
      }
      case "define": {
        const term = l.term ?? "";
        const source = term ? definedBy(term, passages) : undefined;
        if (!term) lineProblem(l, "a [define] line must name its term: [define: term]");
        else if (source) lineProblem(l, `P${source.id} defines "${term}"; cite it instead of a [define] line`);
        else if (!mentions(l.text, term)) lineProblem(l, `it does not use the term "${term}" it defines`);
        else {
          const { numbers, code, api, names } = specificsOf(l.text);
          const own = new Set(tokens(term));
          const extra = [
            ...numbers.map((n) => `the number ${n}`),
            ...code.filter((c) => normalize(c) !== normalize(term)).map((c) => `\`${c}\``),
            ...api.filter((a) => normalize(a) !== normalize(term)),
            ...names.filter((n) => !titleNames.has(n.toLowerCase()) && !own.has(n.toLowerCase())).map((n) => `the name "${n}"`),
          ];
          if (extra.length > 0) lineProblem(l, `a [define] line holds no numbers, code or names beyond its term, but it has ${list(extra)}`);
        }
        return;
      }
      case "walk": {
        if (!example || !l.codeLines) return; // a walk-through without an example is reported by checkLessonRules
        const [a, b] = l.codeLines;
        if (a < 1 || b > codeLines.length) {
          lineProblem(l, `the example has lines 1 to ${codeLines.length}; there is no line ${a < 1 ? a : b}`);
          return;
        }
        const shown = codeLines.slice(a - 1, b);
        const extra = unsupported(l.text, evidenceOf(shown), new Set([...Array.from(lessonEvidence.tokens), ...Array.from(titleNames)]));
        if (extra.length > 0) lineProblem(l, `${list(extra)} ${extra.length === 1 ? "is" : "are"} not in the code line${a === b ? "" : "s"} it explains`);
        return;
      }
      case "close": {
        const earlier = all.slice(0, i).map((x) => x.text);
        const extra = unsupported(l.text, evidenceOf(earlier), titleNames);
        if (extra.length > 0) lineProblem(l, `the closing line may only restate the lesson, but ${list(extra)} ${extra.length === 1 ? "is" : "are"} new`);
        return;
      }
      default:
        return; // untagged: checkLessonRules reports it
    }
  });

  // Walk-through: every line of the example's code, in order.
  if (example) {
    const walk = parts.walk.filter((w) => w.codeLines && w.codeLines[0] >= 1 && w.codeLines[1] <= codeLines.length);
    let lastStart = 0;
    for (const w of walk) {
      if (w.codeLines![0] < lastStart) lineProblem(w, "the walk-through must follow the code from top to bottom");
      lastStart = Math.max(lastStart, w.codeLines![0]);
    }
    const covered = new Set(walk.flatMap((w) => Array.from({ length: w.codeLines![1] - w.codeLines![0] + 1 }, (_, k) => w.codeLines![0] + k)));
    const missing = codeLines.map((c, k) => (c.trim() && !covered.has(k + 1) ? k + 1 : 0)).filter((n) => n > 0);
    if (missing.length > 0) {
      problems.push({ line: null, where: "walk", text: missing.join(","), reason: `the walk-through skips line${missing.length === 1 ? "" : "s"} ${missing.join(", ")} of the example` });
    }
  }

  // Every key term the lesson uses is defined: by a cited passage that
  // defines it, or by a [define] line when no passage does.
  for (const term of ctx.terms) {
    const used = all.some((l) => !(l.kind === "define" && l.term === term) && mentions(l.text, term));
    if (!used) continue;
    const viaPassage = cited.some((l) =>
      l.cites.some((id) => {
        const p = byId.get(id);
        return p !== undefined && definedBy(term, [p]) !== undefined;
      })
    );
    const viaLine = all.some((l) => l.kind === "define" && l.term !== null && mentions(l.term, term));
    if (viaPassage || viaLine) continue;
    const source = definedBy(term, passages);
    problems.push({
      line: null,
      where: "terms",
      text: term,
      reason: source
        ? `the lesson uses "${term}" but never defines it; P${source.id} defines it`
        : `the lesson uses "${term}" but never defines it; no passage does, so add a [define: ${term}] line`,
    });
  }

  // Title and summary cite nothing of their own.
  for (const [where, text] of [["title", lesson.title], ["summary", lesson.summary]] as const) {
    const { numbers, names } = specificsOf(text);
    for (const n of numbers) {
      if (!lessonEvidence.numbers.has(n)) problems.push({ line: null, where, text, reason: `the number ${n} is in no passage this lesson cites` });
    }
    // Titles are written in Title Case, so a capital there is not a name.
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
