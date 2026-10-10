import { Fragment, type ReactNode } from "react";

import { NOT_FROM_SOURCE } from "@/lib/learning/constants";
import { parseMarkdownBlocks, type Block, type InlineNode } from "@/lib/markdown-blocks";
import { EYEBROW } from "./ui";

/**
 * A stored lesson body (Markdown rendered by lib/learning/lesson-format.ts),
 * drawn with the reading styles from the approved lesson mockup.
 *
 * Built on lib/markdown-blocks.ts — the block tree, not an HTML string — so
 * nothing is injected as HTML. Links are drawn as plain text: a lesson never
 * contains one (the writer refers to sources by number and the rules reject
 * any URL), and the sources list under the text is the only place a link is
 * shown, from rows the server fetched itself.
 */

function inline(nodes: InlineNode[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.type) {
      case "text":
        return <Fragment key={i}>{n.value}</Fragment>;
      case "code":
        return (
          <code key={i} className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[0.8em] text-foreground">
            {n.value}
          </code>
        );
      case "bold":
        return (
          <strong key={i} className="font-semibold text-foreground">
            {inline(n.children)}
          </strong>
        );
      case "italic":
        // A [define] sentence is stored with "*(not from a source)*" after it
        // (lib/learning/lesson-format.ts): drawn as a small mark, not as prose.
        if (plainText(n.children) === NOT_FROM_SOURCE) {
          return (
            <span
              key={i}
              className="ml-1 inline-block rounded border border-border px-1 align-middle font-sans text-[11px] not-italic leading-4 text-muted-foreground"
            >
              not from a source
            </span>
          );
        }
        return <em key={i}>{inline(n.children)}</em>;
      case "link":
        return <Fragment key={i}>{inline(n.children)}</Fragment>;
    }
  });
}

function plainText(nodes: InlineNode[]): string {
  return nodes
    .map((n) => (n.type === "text" || n.type === "code" ? n.value : plainText(n.children)))
    .join("");
}

const READING = "font-serif text-[18px] leading-[29px] text-reading";
const CODE =
  "overflow-x-auto whitespace-pre rounded-xl bg-surface-raised p-[14px] font-mono text-[13px] leading-[22px] text-foreground";

function block(b: Block, i: number, blocks: Block[]): ReactNode {
  switch (b.type) {
    case "heading":
      return (
        <h2 key={i} className="pt-2 font-sans text-[17px] font-bold leading-6 text-foreground">
          {inline(b.content)}
        </h2>
      );
    case "paragraph": {
      // The renderer writes the example's output as: code, "Expected output:", code.
      if (plainText(b.content).trim() === "Expected output:" && blocks[i + 1]?.type === "code") {
        return (
          <p key={i} className={EYEBROW}>
            Expected output
          </p>
        );
      }
      return (
        <p key={i} className={READING}>
          {inline(b.content)}
        </p>
      );
    }
    case "list":
      return (
        <ul key={i} className={`${READING} list-disc space-y-2 pl-6 marker:text-muted-foreground`}>
          {b.items.map((item, j) => (
            <li key={j}>{inline(item)}</li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <blockquote key={i} className={`${READING} border-l-2 border-border-col pl-4 italic`}>
          {inline(b.content)}
        </blockquote>
      );
    case "code": {
      const isOutput = i > 0 && blocks[i - 1]?.type === "paragraph";
      return (
        <pre
          key={i}
          className={CODE}
          translate="no"
          tabIndex={0}
          aria-label={isOutput ? "Expected output" : "Code example"}
        >
          <code>{b.value}</code>
        </pre>
      );
    }
    case "table":
      return (
        <div key={i} className="overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr>{b.header.map((c, j) => <th key={j} className="border-b border-border py-2 pr-3 font-semibold">{inline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j}>{r.map((c, k) => <td key={k} className="border-b border-border py-2 pr-3">{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr key={i} className="border-border" />;
  }
}

export function LessonBody({ body }: { body: string }) {
  const blocks = parseMarkdownBlocks(body);
  return <div className="space-y-4">{blocks.map((b, i) => block(b, i, blocks))}</div>;
}
