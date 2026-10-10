import type { Problem, Sentence } from "@/lib/learning/explanation";
import type { SourceBlock } from "@/lib/learning/passages";
import { hasWebAddress } from "@/lib/learning/sources";

/**
 * G1, the code rule (Udit, 2026-10-10). No AI: pure and deterministic, so it
 * costs nothing and gives the same answer every time.
 *
 *   Any code, function or library name, or number in the explanation must
 *   appear in the shown passages or code, or be the value a shown line
 *   produces.
 *
 * "Shown" is exactly the source block the reader sees above the explanation:
 * its 1-3 passages and its code example, output lines included — nothing
 * else from the page.
 *
 * How each thing is found in a sentence and checked:
 *   1. `code spans`: the span, lower-cased with quotes and spacing evened out
 *      and a trailing "()" dropped, must occur in the shown text. A span that
 *      is only a number is checked as a number (rule 7).
 *   Outside code spans:
 *   2. calls, a name glued to "(" — print(, np.array( — must be a name in
 *      the shown text;
 *   3. dotted names (np.array, os.path) — the same; "e.g" and "i.e" are not
 *      names;
 *   4. snake_case names (my_list) — the same;
 *   5. mixed-case names (NumPy, DataFrame, camelCase) — the same, ignoring
 *      case;
 *   6. a word right before "function", "method", "module", "library",
 *      "package", "class", "keyword" or "statement" ("the print function",
 *      "the math module") is a name — the same; ordinary words in that place
 *      ("the built-in function", "this method") are not names;
 *      and the names of well-known libraries (numpy, pandas, matplotlib, …)
 *      wherever they appear — the same;
 *   7. every number written in digits — "4", "0.125", "1,000" (read as
 *      1000), a minus sign not part of it — must be a number in the shown
 *      text, or the value a shown line produces (below).
 * And, separately, no web address anywhere (the no-links rule).
 *
 * NOT detected, on purpose: a function's name used as a plain English word
 * with no parentheses, backticks or cue word after it ("Python can print
 * text", "a list of numbers"). Telling the name print from the verb print
 * needs meaning, which is G2's job; a list of builtins would flag "type",
 * "list" and "set" in ordinary sentences. Numbers written as words ("two")
 * are not checked either.
 *
 * "The value a shown line produces": the code is NOT run. A line of the
 * shown code that is plain arithmetic — numbers, names set earlier in the
 * same example, + - * / // % ** and brackets, with Python's rules (so 8 / 5
 * is 1.6 and 45 // 7 is 6) — is worked out here, as a bare expression,
 * print(expression), an assignment or an augmented assignment (x += 1). Its
 * RESULT is a produced value, written as Python writes it (45, 1.6, 5.0). The
 * values of its parts are not: for 50 - 5*6 the line produces 20, not 30. In
 * an interactive example (">>>" prompts) only prompt lines are worked out —
 * the other lines are output, already shown — and a bare expression's value
 * becomes "_", as it does in Python. Anything else (text, function calls,
 * loops) produces no value here.
 */

/** Lower-case, one space, no quote marks, plain dashes: so 'Hello' and “Hello” compare equal. */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every number written in digits, as a plain string: "1,000" → "1000",
 * "-7" → "7". A number glued to letters ("python3", "h1") is part of a word.
 * No lookbehind (Safari before 16.4 cannot parse one, and a regex literal it
 * cannot parse breaks the whole bundle chunk).
 */
export function numbersIn(s: string): string[] {
  return Array.from(s.matchAll(/(^|[^A-Za-z0-9._])((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?![A-Za-z0-9_])/g), (m) => m[2].replace(/,/g, ""));
}

const NAME = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g;

/** Every name in the text, lower case, dotted names also as their parts. */
function namesIn(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of Array.from(s.matchAll(NAME))) {
    const n = m[0].toLowerCase();
    out.add(n);
    for (const part of n.split(".")) out.add(part);
  }
  return out;
}

// ─── the values shown lines produce ──────────────────────────────────────

interface Value {
  v: number;
  float: boolean;
}

type Token = { kind: "num"; value: Value } | { kind: "name"; name: string } | { kind: "op"; op: string };

function tokenize(src: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const space = /^\s+/.exec(rest);
    if (space) {
      i += space[0].length;
      continue;
    }
    const num = /^(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?/.exec(rest);
    if (num) {
      const text = num[0].replace(/_/g, "");
      const float = /[.eE]/.test(text);
      out.push({ kind: "num", value: { v: Number(text), float } });
      i += num[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (name) {
      out.push({ kind: "name", name: name[0] });
      i += name[0].length;
      continue;
    }
    const op = /^(?:\*\*=|\/\/=|\*\*|\/\/|[+\-*/%]=|[+\-*/%()=])/.exec(rest);
    if (!op) return null;
    out.push({ kind: "op", op: op[0] });
    i += op[0].length;
  }
  return out;
}

function arith(op: string, a: Value, b: Value): Value | null {
  const float = a.float || b.float;
  let v: number;
  switch (op) {
    case "+":
      v = a.v + b.v;
      break;
    case "-":
      v = a.v - b.v;
      break;
    case "*":
      v = a.v * b.v;
      break;
    case "/":
      if (b.v === 0) return null;
      return { v: a.v / b.v, float: true };
    case "//":
      if (b.v === 0) return null;
      v = Math.floor(a.v / b.v);
      break;
    case "%":
      if (b.v === 0) return null;
      v = a.v - b.v * Math.floor(a.v / b.v);
      break;
    case "**":
      if (a.v === 0 && b.v < 0) return null;
      if (!float && b.v < 0) return { v: Math.pow(a.v, b.v), float: true };
      v = Math.pow(a.v, b.v);
      break;
    default:
      return null;
  }
  if (!Number.isFinite(v) || (!float && !Number.isSafeInteger(v))) return null;
  return { v, float };
}

/** Recursive descent over one line's tokens, with Python's precedence: ** binds tighter than a leading minus. */
function evaluate(tokens: Token[], env: Map<string, Value>): Value | null {
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const isOp = (op: string) => {
    const t = peek();
    return t !== undefined && t.kind === "op" && t.op === op;
  };
  const expr = (): Value | null => {
    let left = term();
    while (left && (isOp("+") || isOp("-"))) {
      const op = (tokens[pos++] as { op: string }).op;
      const right = term();
      left = right ? arith(op, left, right) : null;
    }
    return left;
  };
  const term = (): Value | null => {
    let left = unary();
    while (left && (isOp("*") || isOp("/") || isOp("//") || isOp("%"))) {
      const op = (tokens[pos++] as { op: string }).op;
      const right = unary();
      left = right ? arith(op, left, right) : null;
    }
    return left;
  };
  const unary = (): Value | null => {
    if (isOp("-") || isOp("+")) {
      const op = (tokens[pos++] as { op: string }).op;
      const v = unary();
      return v ? { v: op === "-" ? -v.v : v.v, float: v.float } : null;
    }
    return power();
  };
  const power = (): Value | null => {
    const base = atom();
    if (base && isOp("**")) {
      pos++;
      const exp = unary();
      return exp ? arith("**", base, exp) : null;
    }
    return base;
  };
  const atom = (): Value | null => {
    const t = tokens[pos++];
    if (!t) return null;
    if (t.kind === "num") return t.value;
    if (t.kind === "name") return env.get(t.name) ?? null;
    if (t.op !== "(") return null;
    const v = expr();
    if (!v || !isOp(")")) return null;
    pos++;
    return v;
  };
  const v = expr();
  return v && pos === tokens.length ? v : null;
}

/** A number as Python's repr writes it, or null where the two languages differ (huge or tiny floats). */
export function pythonRepr(x: Value): string | null {
  if (!Number.isFinite(x.v)) return null;
  if (!x.float) return Number.isSafeInteger(x.v) ? String(x.v) : null;
  const a = Math.abs(x.v);
  if (a >= 1e16 || (a !== 0 && a < 1e-4)) return null;
  return Number.isInteger(x.v) ? `${x.v}.0` : String(x.v);
}

/** The value of one line of code, and the name it is stored in; null when it is not plain arithmetic. */
function lineValue(line: string, env: Map<string, Value>): { name: string | null; value: Value } | null {
  const tokens = tokenize(line);
  if (!tokens || tokens.length === 0) return null;
  const [a, b] = tokens;
  if (a.kind === "name" && a.name === "print" && b?.kind === "op" && b.op === "(") {
    const last = tokens[tokens.length - 1];
    if (last.kind !== "op" || last.op !== ")") return null;
    const value = evaluate(tokens.slice(2, -1), env);
    return value ? { name: null, value } : null;
  }
  if (a.kind === "name" && b?.kind === "op" && /^(?:\*\*|\/\/|[+\-*/%])?=$/.test(b.op)) {
    const rhs = evaluate(tokens.slice(2), env);
    if (!rhs) return null;
    if (b.op === "=") return { name: a.name, value: rhs };
    const old = env.get(a.name);
    const value = old ? arith(b.op.slice(0, -1), old, rhs) : null;
    return value ? { name: a.name, value } : null;
  }
  const value = evaluate(tokens, env);
  return value ? { name: null, value } : null;
}

/** The values the shown code's lines produce, as Python writes them. */
export function producedValues(code: string | null): string[] {
  if (code === null) return [];
  const lines = code.split("\n");
  const interactive = lines.some((l) => /^\s*>>>/.test(l));
  const env = new Map<string, Value>();
  const out: string[] = [];
  for (const raw of lines) {
    let line = raw;
    if (interactive) {
      const prompt = /^\s*(?:>>>|\.\.\.)(?:\s(.*))?$/.exec(line);
      if (!prompt) continue; // output: shown on the page already
      line = prompt[1] ?? "";
    }
    if (/["']/.test(line)) continue; // text: not arithmetic, and a "#" in it may not be a comment
    line = line.replace(/#.*$/, "");
    if (!line.trim()) continue;
    const r = lineValue(line, env);
    if (!r) continue;
    if (r.name) env.set(r.name, r.value);
    else if (interactive) env.set("_", r.value);
    const shown = pythonRepr(r.value);
    if (shown !== null) out.push(shown);
  }
  return out;
}

// ─── the rule ─────────────────────────────────────────────────────────────

const CUE = /\b([A-Za-z_][\w.-]*)(?:\(\))?\s+(?:function|method|module|library|package|class|keyword|statement)s?\b/g;

/** Words that sit before a cue word without being a name: "the built-in function", "this method". */
const NOT_NAMES = new Set([
  "a", "an", "the", "this", "that", "these", "those", "its", "it", "their", "your", "our", "my", "his", "her",
  "same", "new", "built-in", "builtin", "special", "main", "simple", "small", "own", "other", "another", "each",
  "every", "one", "first", "second", "next", "last", "python", "standard", "whole", "entire", "helper", "useful",
  "common", "single", "separate", "different", "following", "previous", "short", "long", "real", "specific",
  "given", "particular", "certain", "such", "any", "some", "no", "many", "few", "several", "all", "in", "to",
  "for", "of", "on", "with", "by", "from", "as", "at", "into", "called", "named", "is", "was", "be", "and", "or",
]);

/** Library names that are not English words, so they can be checked wherever they appear. */
const LIBRARIES = [
  "numpy", "pandas", "scipy", "matplotlib", "seaborn", "sklearn", "scikit-learn", "tensorflow", "pytorch",
  "jax", "jupyter", "xgboost", "lightgbm", "statsmodels", "nltk", "opencv", "plotly", "langchain",
];

const NOT_DOTTED = new Set(["e.g", "i.e"]);

interface Evidence {
  /** normalize() of every shown passage and the code. */
  text: string;
  names: Set<string>;
  numbers: Set<string>;
}

export function evidenceOf(source: SourceBlock): Evidence {
  const joined = [...source.passages, source.code ?? ""].join("\n");
  return {
    text: normalize(joined),
    names: namesIn(joined),
    numbers: new Set([...numbersIn(joined), ...producedValues(source.code)]),
  };
}

function hasWord(haystack: string, word: string): boolean {
  const w = normalize(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return w.length > 0 && new RegExp(`(^|[^a-z0-9_])${w}($|[^a-z0-9_])`).test(haystack);
}

/** What one sentence names or states that the shown source does not hold, in words. Each name is reported once. */
export function unshown(text: string, ev: Evidence): string[] {
  const out: string[] = [];
  const reported = new Set<string>();
  /** `key` is what makes two findings the same: "print" for print() and "the print function". */
  const add = (key: string, words: string) => {
    if (reported.has(key)) return;
    reported.add(key);
    out.push(words);
  };
  const isNumber = (s: string) => /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$|^\d+(?:\.\d+)?$/.test(s);

  for (const m of Array.from(text.matchAll(/`([^`]+)`/g))) {
    const span = m[1].trim();
    if (!span) continue;
    const bare = span.replace(/^[-+]/, "");
    if (isNumber(bare)) {
      const n = bare.replace(/,/g, "");
      if (!ev.numbers.has(n)) add(`#${n}`, `the number ${bare}`);
      continue;
    }
    const needle = normalize(span).replace(/\(\)$/, "");
    if (needle && !ev.text.includes(needle)) add(needle, `\`${span}\``);
  }
  const plain = text.replace(/`[^`]*`/g, " ");

  const known = (name: string) => ev.names.has(name.toLowerCase());
  const name = (n: string, words = n) => {
    if (!known(n)) add(n.toLowerCase(), words);
  };
  for (const m of Array.from(plain.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\(/g))) name(m[1], `${m[1]}()`);
  for (const m of Array.from(plain.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\b/g))) {
    if (!NOT_DOTTED.has(m[1].toLowerCase())) name(m[1]);
  }
  for (const m of Array.from(plain.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g))) name(m[1]);
  for (const m of Array.from(plain.matchAll(/\b([a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*)\b/g))) name(m[1]);
  for (const m of Array.from(plain.matchAll(CUE))) {
    const n = m[1].replace(/[.-]+$/, "");
    // "the line's statement": the "s" of a possessive is not a name, nor is any single letter here.
    const before = plain[(m.index ?? 0) - 1] ?? "";
    if (n.length < 2 || /['’]/.test(before) || NOT_NAMES.has(n.toLowerCase())) continue;
    if (!known(n) && !hasWord(ev.text, n)) add(n.toLowerCase(), `the name "${n}"`);
  }
  for (const lib of LIBRARIES) {
    if (hasWord(normalize(plain), lib) && !hasWord(ev.text, lib)) add(lib, `the library ${lib}`);
  }
  for (const n of numbersIn(plain)) {
    if (!ev.numbers.has(n)) add(`#${n}`, `the number ${n}`);
  }
  return out;
}

function list(items: string[]): string {
  return items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** G1 and the no-links rule over the given sentences. Each problem names its sentence, so the fix can resend it. */
export function checkCodeRule(sentences: Sentence[], source: SourceBlock): Problem[] {
  const ev = evidenceOf(source);
  const problems: Problem[] = [];
  for (const s of sentences) {
    if (hasWebAddress(s.text)) {
      problems.push({ sentence: s.id, check: "links", text: s.text, reason: "it contains a web address; the lesson has no links" });
    }
    const missing = unshown(s.text, ev);
    if (missing.length > 0) {
      problems.push({
        sentence: s.id,
        check: "G1",
        text: s.text,
        reason: `${list(missing)} ${missing.length === 1 ? "is" : "are"} not in the shown source, and no shown line produces ${missing.length === 1 ? "it" : "them"}`,
      });
    }
  }
  return problems;
}
