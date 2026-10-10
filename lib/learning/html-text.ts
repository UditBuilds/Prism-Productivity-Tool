/**
 * HTML → readable text for the lesson writer. Pure, dependency-free (decision
 * 17: no new npm package), and deliberately modest: lesson sources are
 * documentation and tutorial pages, where dropping the chrome and keeping the
 * main column is enough. The text is used twice — as the writer's source
 * excerpt and as the haystack the grounding check (grounding.ts) searches for
 * quotes — so both see exactly the same characters.
 */

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“",
  rdquo: "”", copy: "©", reg: "®", trade: "™", times: "×", rarr: "→",
  larr: "←", middot: "·", bull: "•", laquo: "«", raquo: "»", deg: "°",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (whole, name: string) => {
    const lower = name.toLowerCase();
    if (lower.startsWith("#x")) {
      const code = parseInt(lower.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    if (lower.startsWith("#")) {
      const code = parseInt(lower.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[lower] ?? whole;
  });
}

function metaContent(html: string, key: string): string | null {
  // property="og:title" content="…" — in either attribute order.
  const a = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i").exec(html);
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i").exec(html);
  const v = (a?.[1] ?? b?.[1] ?? "").trim();
  return v ? decodeEntities(v).replace(/\s+/g, " ").trim() : null;
}

/** "www.docs.python.org" → "docs.python.org" */
export function siteNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the web";
  }
}

export interface PageText {
  title: string;
  siteName: string;
  text: string;
}

export function extractPage(body: string, contentType: string, url: string): PageText {
  const siteFallback = siteNameFromUrl(url);
  if (contentType.startsWith("text/plain")) {
    return { title: siteFallback, siteName: siteFallback, text: tidy(body) };
  }

  let html = body.replace(/<!--[\s\S]*?-->/g, " ");
  const title =
    metaContent(html, "og:title") ??
    decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim());
  const siteName = metaContent(html, "og:site_name") ?? siteFallback;

  html = html.replace(
    /<(script|style|noscript|svg|template|iframe|nav|header|footer|aside|form|button|select|dialog)\b[\s\S]*?<\/\1\s*>/gi,
    " "
  );
  const main =
    /<main\b[\s\S]*?<\/main\s*>/i.exec(html)?.[0] ??
    /<article\b[\s\S]*?<\/article\s*>/i.exec(html)?.[0] ??
    /<body\b[\s\S]*?<\/body\s*>/i.exec(html)?.[0] ??
    html;

  // Code keeps its entities ENCODED until the very end: decoding here turned
  // `while a &lt; 10:` into `while a < 10:`, and the tag strip below then ate
  // everything from that `<` to the next `>` (measured 2026-10-10 on
  // docs.python.org: a whole loop and its output vanished, and `<class 'str'>`
  // output disappeared from realpython.com).
  const text = main
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_m, code: string) =>
      `\n\n\`\`\`\n${code.replace(/<[^>]+>/g, "").replace(/^\n+|\s+$/g, "")}\n\`\`\`\n\n`
    )
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    // Table cells get a separator: without one a row read "int42, -7,
    // 10**100Whole numbers of any size" (onlinepython.dev, 2026-10-10), and
    // the lesson quoted it that way.
    .replace(/<\/(td|th)\s*>/gi, " | ")
    .replace(/<\/(p|div|section|li|h[1-6]|tr|table|blockquote|dd|dt|figure|ul|ol)\s*>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<h[1-6]\b[^>]*>/gi, "\n\n## ")
    .replace(/<[^>]+>/g, "");

  return {
    title: (title || siteName).slice(0, 300),
    siteName: siteName.slice(0, 200),
    text: tidy(decodeEntities(text)),
  };
}

const FENCED = /```[^\n]*\n[\s\S]*?\n```/g;

/**
 * Whitespace clean-up for prose only. Code blocks keep their indentation and
 * blank lines: an example is shown exactly as its source wrote it (decision
 * 2), and Python's meaning depends on indentation.
 */
function tidy(s: string): string {
  const prose = (p: string) =>
    p
      .replace(/[ \t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n");
  const normalized = s.replace(/\r\n?/g, "\n");
  let out = "";
  let last = 0;
  for (const m of Array.from(normalized.matchAll(FENCED))) {
    out += prose(normalized.slice(last, m.index)) + m[0].replace(/ /g, " ").replace(/[ \t]+$/gm, "");
    last = (m.index ?? 0) + m[0].length;
  }
  return (out + prose(normalized.slice(last))).replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * A page's text as units: whole fenced code blocks (blank lines inside them
 * included) and the prose paragraphs between them. Splitting on blank lines
 * alone cut code blocks in half and left their fences unclosed (measured
 * 2026-10-10 on docs.python.org and realpython.com).
 */
export function textUnits(text: string): string[] {
  const units: string[] = [];
  let last = 0;
  const pushProse = (p: string) => p.split(/\n\n+/).forEach((x) => units.push(x));
  for (const m of Array.from(text.matchAll(FENCED))) {
    pushProse(text.slice(last, m.index));
    units.push(m[0]);
    last = (m.index ?? 0) + m[0].length;
  }
  pushProse(text.slice(last));
  return units.map((u) => u.trim()).filter(Boolean);
}

/**
 * A menu or link list: several short lines and almost no sentences
 * ("Python HOME / Python Intro / ..."). Measured 2026-10-10: on w3schools.com
 * the side menu filled the whole 3,800-character excerpt, because its items
 * contain the query words, and the page's actual lesson never reached the
 * writer.
 */
export function isMenuLike(unit: string): boolean {
  if (unit.startsWith("```")) return false;
  const lines = unit.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  // Two or more short lines with no sentence among them: "Python PIP / Python Try...Except".
  if (lines.every((l) => l.length < 30 && !/[.!?:]$/.test(l))) return true;
  if (lines.length < 3) return false;
  const avg = lines.reduce((n, l) => n + l.length, 0) / lines.length;
  const sentences = lines.filter((l) => /[.!?:]$/.test(l) && l.split(/\s+/).length >= 6).length;
  return avg < 30 && sentences <= lines.length / 5;
}

const QUERY_STOP = new Set([
  "the", "and", "for", "with", "how", "what", "why", "your", "you", "from",
  "that", "this", "into", "use", "using", "learn", "beginner", "beginners",
  "tutorial", "guide", "basics", "introduction", "simple", "first", "step",
]);

/**
 * Query words as the stems a paragraph is searched for. Matching is by
 * substring, so the singular stem finds both forms: "variables" in a step
 * title never matched docs.python.org's "assign a value to a variable", and
 * the one paragraph that defines the idea was left out of the excerpt
 * (measured 2026-10-10).
 */
export function queryTerms(query: string): string[] {
  return Array.from(new Set(queryStems(query)));
}

function queryStems(query: string): string[] {
  const words = query.toLowerCase().match(/[a-z][a-z0-9+#.]{2,}/g) ?? [];
  return words
    .filter((w) => !QUERY_STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("ies") ? w.slice(0, -3) : w.length > 4 && /[^s]s$/.test(w) ? w.slice(0, -1) : w));
}

/**
 * The parts of a page that talk about this step, in page order, within a
 * character budget. Paragraphs are scored by the query terms they hold, each
 * term weighted by how RARE it is on this page: on a Python site every
 * paragraph says "python", so plain counting picked generic paragraphs and
 * left out the one that defines the step's idea (measured 2026-10-10 on
 * docs.python.org). A term the query repeats (the step's title, goal and
 * search all say "variables") is its subject and counts that many times. A
 * page that never mentions the terms contributes its
 * opening instead, and a code block next to a chosen paragraph comes along
 * with it.
 */
export function excerptFor(text: string, query: string, budget: number): string {
  const stems = queryStems(query);
  const terms = Array.from(new Set(stems));
  const paras = textUnits(text).filter((p) => (p.length >= 30 || p.startsWith("```")) && !isMenuLike(p));
  const lowers = paras.map((p) => p.toLowerCase());
  const weight = new Map(
    terms.map((t) => {
      const df = lowers.filter((l) => l.includes(t)).length;
      const repeats = stems.filter((s) => s === t).length;
      return [t, df === 0 ? 0 : repeats * Math.log(1 + paras.length / df)];
    })
  );
  const scored = paras.map((p, i) => {
    const score = terms.reduce((n, t) => n + (lowers[i].includes(t) ? weight.get(t) ?? 0 : 0), 0);
    return { p, i, score };
  });
  const order = [...scored].sort((a, b) => b.score - a.score || a.i - b.i);
  const picked = new Set<number>();
  let used = 0;
  for (const x of order) {
    if (x.score === 0) break;
    if (used + x.p.length > budget) continue;
    picked.add(x.i);
    used += x.p.length + 2;
    const next = scored[x.i + 1];
    if (next && next.p.startsWith("```") && !picked.has(next.i) && used + next.p.length <= budget) {
      picked.add(next.i);
      used += next.p.length + 2;
    }
  }
  if (picked.size === 0) {
    for (const x of scored) {
      if (used + x.p.length > budget) break;
      picked.add(x.i);
      used += x.p.length + 2;
    }
  }
  return scored
    .filter((x) => picked.has(x.i))
    .map((x) => x.p)
    .join("\n\n");
}
