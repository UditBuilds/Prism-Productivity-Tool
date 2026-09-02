/**
 * Unit checks for the note export helpers.
 *
 *   lib/notes/note-export.ts  — clipboard/share text, PDF filename
 *   lib/notes/pdf-text.ts     — the glyph-coverage safety net
 *
 * The second one is the load-bearing test. If a codepoint is present in no
 * font of the react-pdf stack, the renderer throws
 * `Offset is outside the bounds of the DataView` and the ENTIRE export fails —
 * it does not degrade to a blank glyph. Five characters in the real notes
 * table did exactly that, which is why the longest note could not be exported
 * at all. These assertions are what keep that from coming back.
 *
 * Run:  node scripts/test-note-export.mjs
 *
 * Point NOTES_JSON at a [{title, content}] dump to additionally assert that no
 * live note contains a character the fonts cannot draw:
 *   NOTES_JSON=notes.json node scripts/test-note-export.mjs
 *
 * Compiles with the project's own `typescript` devDependency — no test runner.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const out = mkdtempSync(path.join(tmpdir(), "prism-export-"));
let failures = 0;
let checks = 0;

function eq(label, actual, expected) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log("  ok    " + label);
  } else {
    failures++;
    console.log("  FAIL  " + label + "\n        expected " + e + "\n        actual   " + a);
  }
}

function ok(label, condition, detail = "") {
  checks++;
  if (condition) console.log("  ok    " + label);
  else {
    failures++;
    console.log("  FAIL  " + label + (detail ? "\n        " + detail : ""));
  }
}

function compile() {
  // node, not the `tsc` shim — spawning a .cmd without a shell is EINVAL on
  // Windows. tsc flattens to outDir root and copies the imported JSON along.
  execFileSync(
    process.execPath,
    [
      path.join("node_modules", "typescript", "bin", "tsc"),
      "lib/notes/note-export.ts",
      "lib/notes/pdf-text.ts",
      "--outDir",
      out,
      // CommonJS, not ESM: pdf-text.ts imports a .json, and node's ESM loader
      // demands an `with { type: "json" }` attribute that tsc does not emit.
      // Next's bundler has no such requirement, so this is a harness detail.
      "--module",
      "commonjs",
      "--target",
      "es2019",
      "--moduleResolution",
      "node",
      "--resolveJsonModule",
      "--esModuleInterop",
      "--skipLibCheck",
    ],
    { stdio: "inherit" }
  );
  writeFileSync(
    path.join(out, "package.json"),
    JSON.stringify({ type: "commonjs" })
  );
}

async function main() {
  compile();
  const require = createRequire(import.meta.url);
  const ex = require(path.resolve(out, "note-export.js"));
  const pt = require(path.resolve(out, "pdf-text.js"));

  console.log("\nnoteToMarkdown");
  eq("title + body", ex.noteToMarkdown("Title", "Body"), "# Title\n\nBody");
  eq("untitled spark omits the heading", ex.noteToMarkdown("", "Just body"), "Just body");
  eq("whitespace title counts as untitled", ex.noteToMarkdown("   ", "Body"), "Body");
  eq("title with empty body", ex.noteToMarkdown("Title", ""), "# Title");
  eq("both empty", ex.noteToMarkdown("", ""), "");
  eq("markdown source is preserved verbatim",
    ex.noteToMarkdown("T", "- a\n\n**b** `c`"), "# T\n\n- a\n\n**b** `c`");

  console.log("\nsanitizeFilenameStem / pdfFilename");
  eq("plain title", ex.sanitizeFilenameStem("Weekend plan"), "Weekend plan");
  eq("path separators become spaces", ex.sanitizeFilenameStem("a/b\\c:d"), "a b c d");
  eq("wildcards and quotes", ex.sanitizeFilenameStem('x*y?z"w<v>u|t'), "x y z w v u t");
  eq("collapses whitespace runs", ex.sanitizeFilenameStem("a    b"), "a b");
  eq("leading dot stripped", ex.sanitizeFilenameStem(".hidden"), "hidden");
  eq("trailing dot stripped", ex.sanitizeFilenameStem("name."), "name");
  eq("nothing usable → null", ex.sanitizeFilenameStem("///"), null);
  eq("empty → null", ex.sanitizeFilenameStem(""), null);
  eq("whitespace → null", ex.sanitizeFilenameStem("   "), null);
  ok("caps at 60 chars",
    (ex.sanitizeFilenameStem("x".repeat(200)) ?? "").length === 60,
    "got " + (ex.sanitizeFilenameStem("x".repeat(200)) ?? "").length);
  ok("real long YouTube title survives",
    ex.sanitizeFilenameStem(
      "How I Get 10X More Traffic to My Websites (And Make Rs 4 Lakhs/Month)"
    ) !== null);
  eq("filename gets the extension", ex.pdfFilename("Note"), "Note.pdf");
  ok("untitled falls back to a timestamp",
    /^\d{4}-\d{2}-\d{2}-\d{4}\.pdf$/.test(ex.pdfFilename("")),
    ex.pdfFilename(""));
  eq("timestamp stem shape",
    ex.timestampStem(new Date(2026, 8, 2, 14, 35)), "2026-09-02-1435");

  console.log("\nsanitizeForPdf — the characters that actually broke the export");
  // Each of these is present in the live notes table and in NO vendored font.
  eq("U+2011 non-breaking hyphen → hyphen",
    pt.sanitizeForPdf("Micro‑Niche"), "Micro-Niche");
  eq("U+202F narrow no-break space → space",
    pt.sanitizeForPdf("4 kg"), "4 kg");
  eq("zero-width space removed", pt.sanitizeForPdf("a​b"), "ab");
  eq("BOM removed", pt.sanitizeForPdf("﻿text"), "text");
  eq("newlines and tabs survive the net",
    pt.sanitizeForPdf("a\nb\tc\r\nd"), "a\nb\tc\r\nd");
  eq("covered ASCII untouched",
    pt.sanitizeForPdf("Hello, world! 123"), "Hello, world! 123");
  eq("Devanagari is covered and untouched",
    pt.sanitizeForPdf("कैसे"), "कैसे");
  eq("rupee sign is covered", pt.sanitizeForPdf("₹4"), "₹4");
  eq("maths symbols are covered (JetBrains Mono carries them)",
    pt.sanitizeForPdf("≈ ≤ ≥ →"), "≈ ≤ ≥ →");
  eq("smart quotes and dashes are covered",
    pt.sanitizeForPdf("“q” ’ – —"), "“q” ’ – —");

  console.log("\nsanitizeForPdf — the catch-all net");
  // An emoji is in none of the three families. Before the net this threw and
  // killed the whole export; now it degrades to a missing character.
  const emoji = "done \u{1F389} yes";
  ok("emoji is genuinely uncovered", pt.unsupportedCodepoints(emoji).length === 1);
  eq("emoji dropped, rest intact", pt.sanitizeForPdf(emoji), "done  yes");
  ok("astral char treated as one unit, not two surrogates",
    !pt.sanitizeForPdf(emoji).includes("\uD83C") &&
      !pt.sanitizeForPdf(emoji).includes("\uDF89"));
  ok("output of the sanitizer is always fully covered",
    pt.unsupportedCodepoints(pt.sanitizeForPdf("\u{1F389}中‑x")).length === 0);

  if (process.env.NOTES_JSON) {
    console.log("\nlive corpus");
    const rows = JSON.parse(readFileSync(process.env.NOTES_JSON, "utf8"));
    let dirty = 0;
    let dropped = 0;
    for (const r of rows) {
      const src = (r.title || "") + "\n" + (r.content || "");
      const clean = pt.sanitizeForPdf(src);
      if (clean !== src) dirty++;
      dropped += Array.from(src).length - Array.from(clean).length;
      checks++;
      const still = pt.unsupportedCodepoints(clean);
      if (still.length) {
        failures++;
        console.log(
          "  FAIL  note " + JSON.stringify((r.title || "").slice(0, 40)) +
            " still has uncovered codepoints after sanitizing: " +
            still.map((c) => "U+" + c.toString(16).toUpperCase()).join(" ")
        );
      }
    }
    console.log(
      `  ok    ${rows.length} live notes all render-safe after sanitizing ` +
        `(${dirty} needed substitution, ${dropped} chars dropped by the net)`
    );
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
