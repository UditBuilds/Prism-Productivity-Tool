/**
 * Markdown → block tree.
 *
 * `lib/markdown.ts` turns markdown straight into an HTML *string*, which is
 * exactly what the note reader needs and exactly what a PDF renderer cannot
 * use — `@react-pdf/renderer` composes React primitives, not HTML. So the same
 * grammar is expressed once more here as data.
 *
 * ⚠️ THE TWO FILES MUST AGREE. Every block rule below is a deliberate mirror of
 * its counterpart in `lib/markdown.ts` — the fence handling, the "tables flush
 * on the first non-row line" rule, the whitespace-tolerant bullet regex, the
 * unterminated-fence tail. `scripts/test-markdown-blocks.mjs` re-renders this
 * tree back to HTML and asserts it is byte-identical to `renderMarkdown()` over
 * a fixture set, so a change to one file that is not mirrored in the other
 * fails loudly instead of drifting. If you change block grammar, change both.
 *
 * Inline parsing is a real scanner rather than `markdown.ts`'s sequential
 * regex replaces, because a tree needs the *boundaries*, not just substituted
 * text. Precedence is kept identical: code, then bold, then italic, then link.
 */

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  // bold / italic / link nest, because markdown.ts's sequential replaces
  // effectively nest too: it substitutes code first, so a later bold pass wraps
  // the <code> element it already produced. A real note in this account
  // contains **`.br`** and would otherwise export with literal backticks.
  | { type: "bold"; children: InlineNode[] }
  | { type: "italic"; children: InlineNode[] }
  | { type: "link"; href: string; children: InlineNode[] };

export type Block =
  | { type: "heading"; level: number; content: InlineNode[] }
  | { type: "paragraph"; content: InlineNode[] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "quote"; content: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "table"; header: InlineNode[][]; rows: InlineNode[][][] }
  | { type: "hr" };

/**
 * Inline spans. Scans left to right and always takes the EARLIEST match; ties
 * break in declaration order, which is what keeps `**x**` from being read as
 * an empty italic followed by a stray asterisk.
 */
export function parseInline(text: string): InlineNode[] {
  const out: InlineNode[] = [];
  let rest = text;

  // Order matters: code wins over bold wins over italic wins over link, the
  // same precedence markdown.ts gets from the order of its .replace() chain.
  //
  // NO LOOKBEHIND. Safari only gained lookbehind assertions in 16.4, and a
  // regex literal is not transpiled — an unsupported one is a *parse* error
  // that takes down the whole chunk, not just this function. The italic rule
  // therefore captures its preceding character exactly the way markdown.ts's
  // `(^|[^*])\*([^*]+)\*` does, and the scanner steps past that captured
  // prefix instead of asserting behind it.
  type Found = { start: number; end: number; node: InlineNode };
  const matchers: ((s: string) => Found | null)[] = [
    (s) => {
      const m = /`([^`\n]+)`/.exec(s);
      return m
        ? { start: m.index, end: m.index + m[0].length, node: { type: "code", value: m[1] } }
        : null;
    },
    (s) => {
      // `[^*]+` (not a lazy `.+?`) so the inner span cannot itself contain an
      // asterisk — identical to markdown.ts, which means `***x***` is handled
      // the same way by both and bold never swallows a neighbouring emphasis.
      const m = /\*\*([^*]+)\*\*/.exec(s);
      return m
        ? {
            start: m.index,
            end: m.index + m[0].length,
            node: { type: "bold", children: parseInline(m[1]) },
          }
        : null;
    },
    (s) => {
      const m = /(^|[^*])\*([^*\n]+)\*(?!\*)/.exec(s);
      if (!m) return null;
      // m[1] is the guard character (empty at string start); the emphasis
      // itself starts after it.
      return {
        start: m.index + m[1].length,
        end: m.index + m[0].length,
        node: { type: "italic", children: parseInline(m[2]) },
      };
    },
    (s) => {
      const m = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.exec(s);
      return m
        ? {
            start: m.index,
            end: m.index + m[0].length,
            node: { type: "link", href: m[2], children: parseInline(m[1]) },
          }
        : null;
    },
  ];

  while (rest) {
    let best: Found | null = null;

    for (const find of matchers) {
      const f = find(rest);
      if (f && (best === null || f.start < best.start)) best = f;
    }

    if (!best) {
      out.push({ type: "text", value: rest });
      break;
    }
    if (best.start > 0) {
      out.push({ type: "text", value: rest.slice(0, best.start) });
    }
    out.push(best.node);
    rest = rest.slice(best.end);
  }

  return out.filter((n) => n.type !== "text" || n.value.length > 0);
}

/** Split a "| a | b |" row into trimmed cell strings. Mirrors markdown.ts. */
function splitTableRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** A "|---|:--:|" delimiter row — every cell is only dashes/colons. */
function isTableSeparator(row: string): boolean {
  const cells = splitTableRow(row);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function buildTable(rows: string[]): Block | null {
  if (rows.length === 0) return null;
  const header = splitTableRow(rows[0]).map(parseInline);
  const bodyStart = rows.length > 1 && isTableSeparator(rows[1]) ? 2 : 1;
  const body = rows
    .slice(bodyStart)
    .map((r) => splitTableRow(r).map(parseInline));
  return { type: "table", header, rows: body };
}

/**
 * Parse a markdown string into blocks. Supports the same set as
 * `renderMarkdown`: headings, ordered/unordered lists, blockquotes, fenced
 * code, tables, horizontal rules, paragraphs.
 */
export function parseMarkdownBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];

  let list: { ordered: boolean; items: InlineNode[][] } | null = null;
  let inCode = false;
  let codeBuffer: string[] = [];
  let tableBuffer: string[] = [];

  const closeList = () => {
    if (list) {
      blocks.push({ type: "list", ordered: list.ordered, items: list.items });
      list = null;
    }
  };
  const flushTable = () => {
    if (tableBuffer.length) {
      const t = buildTable(tableBuffer);
      if (t) blocks.push(t);
      tableBuffer = [];
    }
  };

  for (const raw of lines) {
    // Fenced code blocks.
    if (raw.trim().startsWith("```")) {
      if (inCode) {
        blocks.push({ type: "code", value: codeBuffer.join("\n") });
        codeBuffer = [];
        inCode = false;
      } else {
        flushTable();
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuffer.push(raw);
      continue;
    }

    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      flushTable();
      continue;
    }

    // Table rows accumulate; the table renders on the first non-row line.
    if (/^\|.+\|$/.test(line.trim())) {
      if (tableBuffer.length === 0) closeList();
      tableBuffer.push(line.trim());
      continue;
    }
    flushTable();

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      closeList();
      blocks.push({ type: "hr" });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      blocks.push({
        type: "heading",
        level: heading[1].length,
        content: parseInline(heading[2]),
      });
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      closeList();
      blocks.push({ type: "quote", content: parseInline(quote[1]) });
      continue;
    }

    // Leading whitespace tolerated so indented bullets join the list
    // (flattened) rather than falling through to a paragraph.
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ul) {
      if (!list || list.ordered) {
        closeList();
        list = { ordered: false, items: [] };
      }
      list.items.push(parseInline(ul[1]));
      continue;
    }

    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      if (!list || !list.ordered) {
        closeList();
        list = { ordered: true, items: [] };
      }
      list.items.push(parseInline(ol[1]));
      continue;
    }

    closeList();
    blocks.push({ type: "paragraph", content: parseInline(line) });
  }

  // An unterminated fence still emits its buffer, same as markdown.ts.
  if (inCode && codeBuffer.length) {
    blocks.push({ type: "code", value: codeBuffer.join("\n") });
  }
  flushTable();
  closeList();

  return blocks;
}
