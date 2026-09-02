/**
 * Drift guard for the two markdown grammars.
 *
 * `lib/markdown.ts` renders markdown to an HTML string (note reader, flashcards,
 * dashboard Revisit rows). `lib/markdown-blocks.ts` renders the same grammar to
 * a block tree, because @react-pdf/renderer composes React primitives and
 * cannot consume HTML. Two parsers for one grammar is exactly the shape that
 * rots — see the three-file `MODEL` constant in CLAUDE.md.
 *
 * So this test re-renders the block tree back into HTML and asserts it is
 * BYTE-IDENTICAL to renderMarkdown() across a fixture set. If someone teaches
 * one file a rule and not the other, this fails.
 *
 * Run:  node scripts/test-markdown-blocks.mjs
 *
 * Compiles the two modules with the project's own `typescript` devDependency —
 * no test runner, no transitive transpiler, matching how lib/pdf/chunk.ts and
 * lib/capture.ts have always been checked here.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(path.join(tmpdir(), "prism-md-"));
let failures = 0;
let checks = 0;

function compile() {
  // Invoke tsc's JS entrypoint through node rather than the `npx`/`tsc` shim —
  // spawning a .cmd shim without a shell is EINVAL on Windows.
  execFileSync(
    process.execPath,
    [
      path.join("node_modules", "typescript", "bin", "tsc"),
      "lib/markdown.ts",
      "lib/markdown-blocks.ts",
      "--outDir",
      out,
      "--module",
      "esnext",
      "--target",
      "es2019",
      "--moduleResolution",
      "bundler",
      "--skipLibCheck",
    ],
    { stdio: "inherit" }
  );
  // tsc emits .js; node needs an ESM hint since there is no package.json there.
  writeFileSync(
    path.join(out, "package.json"),
    JSON.stringify({ type: "module" })
  );
}

// ---------------------------------------------------------------------------
// Re-render a block tree to the exact HTML renderMarkdown() produces.
// ---------------------------------------------------------------------------
const escapeHtml = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function inlineToHtml(nodes) {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
          return escapeHtml(n.value);
        case "code":
          return (
            '<code class="rounded bg-muted px-1 py-0.5 text-[0.85em]">' +
            escapeHtml(n.value) +
            "</code>"
          );
        case "bold":
          return "<strong>" + inlineToHtml(n.children) + "</strong>";
        case "italic":
          return "<em>" + inlineToHtml(n.children) + "</em>";
        case "link":
          return (
            '<a href="' +
            escapeHtml(n.href) +
            '" target="_blank" rel="noreferrer" class="text-accent underline underline-offset-2">' +
            inlineToHtml(n.children) +
            "</a>"
          );
        default:
          throw new Error("unknown inline " + n.type);
      }
    })
    .join("");
}

function blocksToHtml(blocks) {
  const sizes = [
    "text-xl",
    "text-lg",
    "text-base",
    "text-sm",
    "text-sm",
    "text-sm",
  ];
  const lines = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
        lines.push(
          "<h" +
            b.level +
            ' class="mt-3 mb-1 font-semibold ' +
            sizes[b.level - 1] +
            '">' +
            inlineToHtml(b.content) +
            "</h" +
            b.level +
            ">"
        );
        break;
      case "paragraph":
        lines.push("<p>" + inlineToHtml(b.content) + "</p>");
        break;
      case "quote":
        lines.push(
          '<blockquote class="border-l-2 border-border pl-3 text-muted-foreground">' +
            inlineToHtml(b.content) +
            "</blockquote>"
        );
        break;
      case "hr":
        lines.push('<hr class="my-3 border-border" />');
        break;
      case "code":
        lines.push(
          '<pre class="overflow-x-auto rounded-lg bg-muted p-3 text-xs"><code>' +
            escapeHtml(b.value) +
            "</code></pre>"
        );
        break;
      case "list": {
        const tag = b.ordered ? "ol" : "ul";
        const cls = b.ordered
          ? 'class="ml-5 list-decimal space-y-0.5"'
          : 'class="ml-5 list-disc space-y-0.5"';
        lines.push("<" + tag + " " + cls + ">");
        for (const item of b.items) {
          lines.push("<li>" + inlineToHtml(item) + "</li>");
        }
        lines.push("</" + tag + ">");
        break;
      }
      case "table": {
        const thead =
          "<thead><tr>" +
          b.header.map((c) => "<th>" + inlineToHtml(c) + "</th>").join("") +
          "</tr></thead>";
        const tbody = b.rows.length
          ? "<tbody>" +
            b.rows
              .map(
                (r) =>
                  "<tr>" +
                  r.map((c) => "<td>" + inlineToHtml(c) + "</td>").join("") +
                  "</tr>"
              )
              .join("") +
            "</tbody>"
          : "";
        lines.push(
          '<div class="overflow-x-auto"><table>' + thead + tbody + "</table></div>"
        );
        break;
      }
      default:
        throw new Error("unknown block " + b.type);
    }
  }
  return lines.join("\n");
}

const FIXTURES = {
  "everything at once": [
    "# Heading one",
    "",
    "Body with **bold**, *italic*, `inline code` and [a link](https://example.com).",
    "",
    "## Heading two",
    "",
    "- bullet one",
    "- bullet **two**",
    "  - indented bullet",
    "",
    "1. first",
    "2. second",
    "",
    "> a quotation",
    "",
    "```",
    "const x = 1;",
    "if (x > 0) { alert('<b>hi</b>'); }",
    "```",
    "",
    "| Col A | Col B |",
    "|-------|:-----:|",
    "| a1    | b1    |",
    "| `a2`  | **b2**|",
    "",
    "---",
    "",
    "Trailing paragraph.",
  ].join("\n"),
  empty: "",
  "whitespace only": "   \n\n  \n",
  "html injection": "<script>alert(1)</script> & \"quotes\" 'single'",
  "unterminated fence": "intro\n\n```\nnever closed",
  "table without separator": "| a | b |\n| c | d |",
  "table at EOF": "text\n\n| h1 | h2 |\n|----|----|\n| v1 | v2 |",
  "hr variants": "a\n\n---\n\nb\n\n***\n\nc",
  "adjacent lists": "- u1\n- u2\n1. o1\n2. o2\n- u3",
  "deep headings": "# h1\n## h2\n### h3\n#### h4\n##### h5\n###### h6",
  // See KNOWN_DIVERGENCES below — these two are asserted to DIFFER.
  "asterisk edge cases": "a * b, 2*3, **bold** and *em* and ***both***",
  "code containing markdown": "`**not bold**` and `[not a link](x)`",
  "devanagari + rupee":
    "कैसे **शुरू** करें — ₹4 लाख\n\n- पहला\n- दूसरा",
  "consecutive quotes": "> line one\n> line two\n\npara",
  "list then table": "- item\n\n| a |\n|---|\n| b |",
  "nbsp and arrows": "A → B, x ≈ y, p ≤ q, non‑breaking",
  "link inside list": "- see [docs](https://example.com/a_b) now",
  "bold at line start": "**lead** then text",
  "empty table cells": "| a |  |\n|---|---|\n|  | d |",
};

/**
 * The two fixtures where the block tree deliberately does NOT reproduce
 * renderMarkdown's output. Both are artefacts of markdown.ts running four
 * sequential .replace() passes over one string; a real scanner cannot and
 * should not reproduce them. Neither shape occurs anywhere in the live notes
 * table (checked: zero `***` runs, zero inline-code spans containing `**` or a
 * link), so nothing a user has written is affected.
 *
 * These are asserted to DIFFER. If markdown.ts is ever fixed, this test fails
 * and tells you to delete the entry rather than silently going green.
 */
const KNOWN_DIVERGENCES = {
  "asterisk edge cases":
    "markdown.ts emits <em><strong>both</strong></em> for ***both***: its bold " +
    "pass rewrites the inner **both**, and the italic pass then wraps the <strong> " +
    "element it just created. Nested emphasis is not expressible as a single " +
    "left-to-right scan without a second pass, and *** never appears in real notes.",
  "code containing markdown":
    "markdown.ts BOLDS INSIDE INLINE CODE — its bold/italic/link passes run over " +
    "the whole string including the <code> elements the code pass already emitted, " +
    "so `**x**` renders bold. That is a bug in the HTML renderer; markdown inside " +
    "inline code must stay literal. The block tree is correct here on purpose.",
};

async function main() {
  compile();
  const md = await import(
    pathToFileURL(path.join(out, "markdown.js")).href
  );
  const blocksMod = await import(
    pathToFileURL(path.join(out, "markdown-blocks.js")).href
  );

  // Fixture corpus + anything piped in via NOTES_JSON (a file of
  // [{title, content}] — used to run this against the real notes table).
  const cases = Object.entries(FIXTURES);
  if (process.env.NOTES_JSON) {
    const rows = JSON.parse(readFileSync(process.env.NOTES_JSON, "utf8"));
    rows.forEach((r, i) => {
      cases.push([
        "real note #" + (i + 1) + ": " + (r.title || "").slice(0, 40),
        r.content || "",
      ]);
    });
  }

  for (const [name, source] of cases) {
    checks++;
    const expected = md.renderMarkdown(source);
    let actual;
    try {
      actual = blocksToHtml(blocksMod.parseMarkdownBlocks(source));
    } catch (e) {
      failures++;
      console.log("  FAIL  " + name + "\n        threw " + e.message);
      continue;
    }
    const divergence = KNOWN_DIVERGENCES[name];
    if (divergence) {
      if (actual === expected) {
        failures++;
        console.log(
          "  FAIL  " +
            name +
            "\n        expected a KNOWN divergence but the two now agree." +
            "\n        markdown.ts was probably fixed — delete this entry from" +
            "\n        KNOWN_DIVERGENCES. Reason on record: " +
            divergence
        );
      } else {
        console.log("  ok*   " + name + "  (known divergence, asserted)");
      }
      continue;
    }

    if (actual !== expected) {
      failures++;
      let at = 0;
      while (at < expected.length && expected[at] === actual[at]) at++;
      console.log("  FAIL  " + name);
      console.log("        first divergence at char " + at);
      console.log(
        "        expected: " +
          JSON.stringify(expected.slice(Math.max(0, at - 40), at + 60))
      );
      console.log(
        "        actual:   " +
          JSON.stringify(actual.slice(Math.max(0, at - 40), at + 60))
      );
    } else {
      console.log("  ok    " + name);
    }
  }

  rmSync(out, { recursive: true, force: true });
  console.log("\n" + (checks - failures) + "/" + checks + " passed");
  if (failures) process.exit(1);
}

main().catch((e) => {
  rmSync(out, { recursive: true, force: true });
  console.error(e);
  process.exit(1);
});
