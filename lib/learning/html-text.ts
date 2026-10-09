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

  const text = main
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_m, code: string) =>
      `\n\n\`\`\`\n${decodeEntities(code.replace(/<[^>]+>/g, ""))}\n\`\`\`\n\n`
    )
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
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

function tidy(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const QUERY_STOP = new Set([
  "the", "and", "for", "with", "how", "what", "why", "your", "you", "from",
  "that", "this", "into", "use", "using", "learn", "beginner", "beginners",
  "tutorial", "guide", "basics", "introduction", "simple", "first", "step",
]);

function queryTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[a-z][a-z0-9+#.]{2,}/g) ?? [];
  return Array.from(new Set(words.filter((w) => !QUERY_STOP.has(w))));
}

/**
 * The parts of a page that talk about this step, in page order, within a
 * character budget. Paragraphs are scored by how many query terms they hold;
 * a page that never mentions the terms contributes its opening instead, and
 * a code block next to a chosen paragraph comes along with it.
 */
export function excerptFor(text: string, query: string, budget: number): string {
  const terms = queryTerms(query);
  const paras = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 30 || p.startsWith("```"));
  const scored = paras.map((p, i) => {
    const lower = p.toLowerCase();
    const score = terms.reduce((n, t) => n + (lower.includes(t) ? 1 : 0), 0);
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
