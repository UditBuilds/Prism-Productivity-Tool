// Tiny, dependency-free markdown helpers. We deliberately avoid adding a
// markdown library to respect the pinned stack (see CLAUDE.md). The renderer
// escapes HTML *first*, then applies a small set of inline/block transforms, so
// the resulting HTML is safe to inject for our own private notes.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Inline spans: bold, italic, inline code, links. Operates on escaped text. */
function renderInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1 py-0.5 text-[0.85em]">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer" class="text-accent underline underline-offset-2">$1</a>'
    );
}

/**
 * Render a (small) markdown string to an HTML string. Supports: headings,
 * unordered/ordered lists, blockquotes, fenced code blocks, horizontal rules,
 * and the inline spans above. Good enough for note previews.
 */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let inCode = false;
  let codeBuffer: string[] = [];

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const raw of lines) {
    // Fenced code blocks.
    if (raw.trim().startsWith("```")) {
      if (inCode) {
        out.push(
          `<pre class="overflow-x-auto rounded-lg bg-muted p-3 text-xs"><code>${codeBuffer
            .join("\n")}</code></pre>`
        );
        codeBuffer = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuffer.push(escapeHtml(raw));
      continue;
    }

    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      closeList();
      out.push('<hr class="my-3 border-border" />');
      continue;
    }

    // Headings.
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      const sizes = ["text-xl", "text-lg", "text-base", "text-sm", "text-sm", "text-sm"];
      out.push(
        `<h${level} class="mt-3 mb-1 font-semibold ${sizes[level - 1]}">${renderInline(
          escapeHtml(heading[2])
        )}</h${level}>`
      );
      continue;
    }

    // Blockquote.
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      closeList();
      out.push(
        `<blockquote class="border-l-2 border-border pl-3 text-muted-foreground">${renderInline(
          escapeHtml(quote[1])
        )}</blockquote>`
      );
      continue;
    }

    // Unordered list.
    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul) {
      if (listType !== "ul") {
        closeList();
        out.push('<ul class="ml-5 list-disc space-y-0.5">');
        listType = "ul";
      }
      out.push(`<li>${renderInline(escapeHtml(ul[1]))}</li>`);
      continue;
    }

    // Ordered list.
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      if (listType !== "ol") {
        closeList();
        out.push('<ol class="ml-5 list-decimal space-y-0.5">');
        listType = "ol";
      }
      out.push(`<li>${renderInline(escapeHtml(ol[1]))}</li>`);
      continue;
    }

    // Paragraph.
    closeList();
    out.push(`<p>${renderInline(escapeHtml(line))}</p>`);
  }

  if (inCode && codeBuffer.length) {
    out.push(
      `<pre class="overflow-x-auto rounded-lg bg-muted p-3 text-xs"><code>${codeBuffer
        .join("\n")}</code></pre>`
    );
  }
  closeList();
  return out.join("\n");
}

/**
 * Strip markdown syntax down to a plain-text excerpt for note-card previews.
 */
export function markdownExcerpt(md: string, max = 180): string {
  const text = md
    .replace(/```[\s\S]*?```/g, " ") // code fences
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → text
    .replace(/^#{1,6}\s+/gm, "") // heading marks
    .replace(/^>\s?/gm, "") // blockquote marks
    .replace(/^[-*]\s+/gm, "") // bullet marks
    .replace(/^\d+\.\s+/gm, "") // numbered marks
    .replace(/[*_~]/g, "") // emphasis marks
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}
