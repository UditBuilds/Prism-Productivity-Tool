import { hasWebAddress } from "@/lib/learning/sources";

/**
 * The lesson's example (Udit, 2026-10-12, gate 6): written by the AI writer,
 * 1-3 lines typed as in a file, and checked HERE by code, never by AI. Gates
 * 2-5 hunted pages for a real example that used only the step's idea; none of
 * docs.python.org's did for "Print a greeting", and 20b could not be trusted
 * to judge the web's. So the page now gives only the quote, and the example:
 *   - may call only the built-in functions this step's or earlier steps'
 *     titles and goals name (for step 30: print), and must call this step's;
 *   - gives each call exactly ONE value: plain text in quotes — a whole
 *     number only once a step teaches numbers, a name only once a step
 *     teaches storing values and the example stored it first;
 *   - has no >>> prompt, comments, backticks, web addresses, formatting,
 *     operators, imports or loops (the plain scan, scanExtras, as well);
 * and when it is only print() of plain text, code works out its output
 * (outputByCode) instead of trusting the AI's.
 */

// ─── the plain scan: obvious extras ──────────────────────────────────────

/**
 * The lines a learner types: in an interactive example the ">>>" and "..."
 * lines, without the prompt; in a script every line. Output lines never count.
 */
export function inputLines(lines: string[]): string[] {
  const interactive = lines.some((l) => /^\s*>>>/.test(l));
  return interactive ? lines.filter((l) => /^\s*(?:>>>|\.\.\.)/.test(l)).map((l) => l.replace(/^\s*(?:>>>|\.\.\.) ?/, "")) : lines;
}

/**
 * The code with every string literal's text emptied — its prefix and quotes
 * kept, so f"…" is still an f-string — and every comment removed: so
 * print("a = b"), print("100% done") and "# for each" trip nothing.
 */
export function emptyStrings(code: string): string {
  return code
    .replace(/([rRbBfFuU]{0,2})("""|''')[\s\S]*?\2/g, "$1$2$2")
    .replace(/([rRbBfFuU]{0,2})(["'])(?:\\.|(?!\2)[^\\\n])*\2/g, "$1$2$2")
    .replace(/#.*$/gm, "");
}

interface ExtraRule {
  name: string;
  /** Looks at the typed code with its strings emptied and comments removed. */
  found: (typed: string) => boolean;
  /** A step whose title or goal matches this teaches it. */
  teaches: RegExp;
}

/** Stores a value: "Store a number", "Creating variables". */
const TEACHES_ASSIGNMENT = /\b(?:variables?|assign\w*|stor(?:e|es|ing)|names? for)\b/i;

/**
 * Udit's list (2026-10-12): .format(, f-strings, % formatting,
 * = assignment, import, loops. Assignment is a statement that starts with a
 * name and "=" — a keyword argument such as sep="" is not one.
 */
const EXTRAS: ExtraRule[] = [
  { name: ".format(", found: (t) => /\.format\(/.test(t), teaches: /\bformat/i },
  { name: "an f-string", found: (t) => /(?<![A-Za-z0-9_])(?:[rR][fF]|[fF][rR]?)["']/.test(t), teaches: /\bf-?strings?\b|\bformatted string/i },
  { name: "% formatting", found: (t) => /["']\s*%\s*[A-Za-z0-9_(]/.test(t), teaches: /\bformat/i },
  {
    name: "= assignment",
    found: (t) => /^\s*[A-Za-z_][\w.]*(?:\[[^\]\n]*\])?(?:\s*,\s*[A-Za-z_][\w.]*)*\s*(?:\*\*|\/\/|>>|<<|[-+*/%&|^@])?=(?!=)/m.test(t),
    teaches: TEACHES_ASSIGNMENT,
  },
  { name: "import", found: (t) => /^\s*(?:import|from)\s+[A-Za-z_]/m.test(t), teaches: /\bimport/i },
  { name: "a loop", found: (t) => /^\s*(?:for|while)\b|\bfor\s+[\w, ]+\s+in\b/m.test(t), teaches: /\b(?:loop|repeat|iterat)\w*/i },
];

/**
 * The scan of one example: every extra found in the code a learner types, and
 * the ones that block it — those that neither this step nor an earlier one
 * teaches. `taught` is this step's and the earlier steps' titles and goals.
 */
export function scanExtras(lines: string[], taught: string): { found: string[]; blocking: string[] } {
  const typed = emptyStrings(inputLines(lines).join("\n"));
  const hits = EXTRAS.filter((r) => r.found(typed));
  return { found: hits.map((r) => r.name), blocking: hits.filter((r) => !r.teaches.test(taught)).map((r) => r.name) };
}

// ─── what the step allows ────────────────────────────────────────────────

/** Built-in functions a step can name in its title or goal. */
const BUILTINS = ["print", "input", "len", "str", "int", "float", "round", "range", "type", "abs", "sum", "min", "max", "sorted", "bool"];

export interface ExampleRules {
  /** Built-ins this step names: the example must call one (it shows the step). */
  stepCalls: string[];
  /** Built-ins this step or an earlier one names: the only calls allowed. */
  allowedCalls: string[];
  /** A whole number may be a value: a step so far teaches numbers. */
  numbers: boolean;
  /** "name = value" is allowed: a step so far teaches storing values. */
  assignment: boolean;
  /** This step's and the earlier steps' titles and goals, for the plain scan. */
  taught: string;
}

const names = (text: string) => BUILTINS.filter((b) => new RegExp(`\\b${b}\\b`, "i").test(text));

/** The rules for one step, from its title and goal and the earlier steps'. */
export function exampleRulesFor(step: { title: string; goal: string }, earlier: { title: string; goal: string }[]): ExampleRules {
  const own = `${step.title}\n${step.goal}`;
  const taught = [own, ...earlier.map((s) => `${s.title}\n${s.goal}`)].join("\n");
  return {
    stepCalls: names(own),
    allowedCalls: names(taught),
    numbers: /\b(?:numbers?|integers?|arithmetic|math)\b/i.test(taught),
    assignment: TEACHES_ASSIGNMENT.test(taught),
    taught,
  };
}

/** The same rules, as the writer is told them, so its first example can pass. */
export function exampleRulesText(r: ExampleRules): string {
  const calls = r.allowedCalls.length ? r.allowedCalls.map((c) => `${c}()`).join(", ") : "none";
  const values = ["plain text in single quotes, with no backslash codes such as \\n"];
  if (r.numbers) values.push("a whole number");
  if (r.assignment) values.push("a name the example stored earlier");
  const lines = [
    "- 1 to 3 lines, typed as in a file: no >>> prompt, no comments, no backticks.",
    "- One statement per line.",
    `- Call only: ${calls}.${r.stepCalls.length ? ` Call ${r.stepCalls.map((c) => `${c}()`).join(" or ")} at least once: it is this step's idea.` : ""}`,
    "- Each call gets exactly ONE value.",
    `- A value is ${values.join(", or ")}.`,
    r.assignment ? "- You may store a value with name = value." : "- No = (storing a value comes in a later step).",
    "- No +, * or other operators, no formatting (f-strings, .format, %), no imports, no loops.",
  ];
  return lines.join("\n");
}

// ─── the check ───────────────────────────────────────────────────────────

type Token =
  | { kind: "text"; value: string; prefix: string; escape: boolean }
  | { kind: "number"; raw: string }
  | { kind: "name"; raw: string }
  | { kind: "op"; raw: string }
  | { kind: "comment" };

/** One line as tokens, or why it cannot be read. */
function tokenize(line: string): Token[] | string {
  const out: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "#") {
      out.push({ kind: "comment" });
      break;
    }
    const prefix = /^([rRbBfFuU]{1,2})(?=["'])/.exec(line.slice(i))?.[1] ?? "";
    if (c === '"' || c === "'" || prefix) {
      const at = i + prefix.length;
      const q = line[at];
      if (line.startsWith(q.repeat(3), at)) return "a triple-quoted text value";
      let j = at + 1;
      let value = "";
      let escape = false;
      while (j < line.length && line[j] !== q) {
        if (line[j] === "\\") {
          escape = true;
          value += line.slice(j, j + 2);
          j += 2;
          continue;
        }
        value += line[j];
        j++;
      }
      if (j >= line.length) return "an unfinished text value";
      out.push({ kind: "text", value, prefix, escape });
      i = j + 1;
      continue;
    }
    const num = /^\d+(?:\.\d+)?/.exec(line.slice(i));
    if (num) {
      out.push({ kind: "number", raw: num[0] });
      i += num[0].length;
      continue;
    }
    const name = /^[A-Za-z_]\w*/.exec(line.slice(i));
    if (name) {
      out.push({ kind: "name", raw: name[0] });
      i += name[0].length;
      continue;
    }
    const op = /^(?:\*\*|\/\/|==|!=|<=|>=|->|[-+*/%=<>()[\]{},.:;!&|^~@])/.exec(line.slice(i));
    if (!op) return `the character ${c}`;
    out.push({ kind: "op", raw: op[0] });
    i += op[0].length;
  }
  return out;
}

/** The tokens of a call's arguments, split at top-level commas. */
function splitArgs(tokens: Token[]): Token[][] {
  const args: Token[][] = [[]];
  let depth = 0;
  for (const t of tokens) {
    if (t.kind === "op" && "([{".includes(t.raw)) depth++;
    if (t.kind === "op" && ")]}".includes(t.raw)) depth--;
    if (t.kind === "op" && t.raw === "," && depth === 0) args.push([]);
    else args[args.length - 1].push(t);
  }
  return args.length === 1 && args[0].length === 0 ? [] : args;
}

function shown(tokens: Token[]): string {
  return tokens.map((t) => (t.kind === "text" ? `${t.prefix}'${t.value}'` : t.kind === "comment" ? "#" : t.raw)).join(" ");
}

export interface ExampleCheck {
  ok: boolean;
  /** Each rule the example breaks, in words. */
  problems: string[];
  scan: { found: string[]; blocking: string[] };
}

/** Code's check of the AI's example against the step's rules. */
export function checkExample(lines: string[], rules: ExampleRules): ExampleCheck {
  const problems: string[] = [];
  const typed = lines.map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
  if (typed.length < 1 || typed.length > 3) problems.push(`it has ${typed.length} lines; 1 to 3 are allowed`);
  const stored = new Set<string>();
  let callsStep = false;

  typed.forEach((line, k) => {
    const at = `line ${k + 1}`;
    if (/^\s*(?:>>>|\.\.\.)/.test(line)) {
      problems.push(`${at} starts with a >>> prompt`);
      return;
    }
    if (line.includes("`")) problems.push(`${at} has a backtick`);
    if (hasWebAddress(line)) problems.push(`${at} has a web address`);
    const tokens = tokenize(line.trim());
    if (typeof tokens === "string") {
      problems.push(`${at} cannot be read: ${tokens}`);
      return;
    }
    if (tokens.some((t) => t.kind === "comment")) {
      problems.push(`${at} has a comment`);
      return;
    }
    const value = (arg: Token[]): string | null => {
      if (arg.length !== 1) return `its value is not one plain value (${shown(arg)})`;
      const t = arg[0];
      if (t.kind === "text") {
        if (t.prefix) return `its text has the prefix ${t.prefix} (${/f/i.test(t.prefix) ? "an f-string" : "a special text value"})`;
        if (t.escape) return "its text has a backslash code such as \\n";
        if (!t.value.trim()) return "its text is empty";
        return null;
      }
      if (t.kind === "number") return rules.numbers ? null : "its value is a number, which no step so far teaches";
      if (t.kind === "name") return rules.assignment && stored.has(t.raw) ? null : `its value is the name ${t.raw}, which ${rules.assignment ? "the example has not stored" : "no step so far teaches"}`;
      return `its value is not one plain value (${shown(arg)})`;
    };

    const [first, second] = tokens;
    // name = value
    if (first?.kind === "name" && second?.kind === "op" && second.raw === "=") {
      if (!rules.assignment) problems.push(`${at} stores a value with =, which no step so far teaches`);
      const why = value(tokens.slice(2));
      if (why) problems.push(`${at}: ${why}`);
      stored.add(first.raw);
      return;
    }
    // name(args)
    const last = tokens[tokens.length - 1];
    if (first?.kind === "name" && second?.kind === "op" && second.raw === "(" && last.kind === "op" && last.raw === ")") {
      const fn = first.raw;
      if (!rules.allowedCalls.includes(fn)) {
        problems.push(`${at} calls ${fn}(), which no step so far teaches`);
        return;
      }
      if (rules.stepCalls.includes(fn)) callsStep = true;
      const args = splitArgs(tokens.slice(2, -1));
      if (args.length !== 1) {
        problems.push(`${at} gives ${fn}() ${args.length === 0 ? "no value" : `${args.length} values`}; exactly one is allowed`);
        return;
      }
      const arg = args[0];
      if (arg.length >= 2 && arg[0].kind === "name" && arg[1].kind === "op" && arg[1].raw === "=") {
        problems.push(`${at} gives ${fn}() a keyword argument (${arg[0].raw}=)`);
        return;
      }
      const why = value(arg);
      if (why) problems.push(`${at}: ${why}`);
      return;
    }
    problems.push(`${at} is not a call or a stored value (${shown(tokens)})`);
  });

  if (rules.stepCalls.length && !callsStep) problems.push(`it never calls ${rules.stepCalls.map((c) => `${c}()`).join(" or ")}, this step's idea`);
  const scan = scanExtras(typed, rules.taught);
  for (const b of scan.blocking) {
    const said = problems.some((p) => (b === "= assignment" && p.includes("=")) || p.includes(b.replace(/^an? /, "")));
    if (!said) problems.push(`the plain scan found ${b}, which no step so far teaches`);
  }
  return { ok: problems.length === 0, problems, scan };
}

/**
 * The output, worked out by code: only when every line is print() of one
 * plain text value — print writes the text and ends the line. Null for
 * anything else (its output is the AI's, labelled as such).
 */
export function outputByCode(lines: string[]): string[] | null {
  const typed = lines.map((l) => l.trim()).filter(Boolean);
  if (typed.length === 0) return null;
  const out: string[] = [];
  for (const line of typed) {
    const t = tokenize(line);
    if (typeof t === "string" || t.length !== 4) return null;
    const [fn, open, text, close] = t;
    const plain = text.kind === "text" && !text.prefix && !text.escape;
    if (fn.kind !== "name" || fn.raw !== "print" || open.kind !== "op" || open.raw !== "(" || !plain || close.kind !== "op" || close.raw !== ")") return null;
    out.push(text.value);
  }
  return out;
}
