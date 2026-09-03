/**
 * Unit checks for lib/notes/revisit-summary.ts — the threshold, the render
 * decision, and the digest sent to the model.
 *
 * These matter because the module is the ONLY thing standing between the
 * dashboard and a 114,787-character note. Every branch below has a live row
 * behind it: the real Revisit table is 13 notes, all over the threshold, all
 * with summary NULL at the time this was written.
 *
 * Run:  node scripts/test-revisit-summary.mjs
 *
 * Compiles with the project's own `typescript` devDependency — no test runner,
 * matching scripts/test-note-export.mjs.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const out = mkdtempSync(path.join(tmpdir(), "prism-revisit-"));
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
    console.log(
      "  FAIL  " + label + "\n        expected " + e + "\n        actual   " + a
    );
  }
}

function ok(label, cond) {
  eq(label, !!cond, true);
}

function compile() {
  // The module imports markdownExcerpt from lib/markdown; compile both, and
  // rewrite the "@/" alias to a relative path for plain node ESM.
  const srcs = ["lib/markdown.ts", "lib/notes/revisit-summary.ts"];
  for (const rel of srcs) {
    // Rewrite the "@/" path alias to a sibling import before tsc sees it —
    // there is no tsconfig in the temp dir to resolve the alias.
    const text = readFileSync(path.join(root, rel), "utf8").replace(
      /["']@\/lib\/markdown["']/g,
      '"./markdown"'
    );
    writeFileSync(path.join(out, path.basename(rel)), text);
  }
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules", "typescript", "bin", "tsc"),
      "--target", "es2019",
      "--module", "es2020",
      "--moduleResolution", "node",
      "--skipLibCheck",
      path.join(out, "markdown.ts"),
      path.join(out, "revisit-summary.ts"),
    ],
    { stdio: "inherit" }
  );
  // ESM needs the extension that tsc's "node" resolution omits.
  const js = path.join(out, "revisit-summary.js");
  writeFileSync(
    js,
    readFileSync(js, "utf8").replace(/["']\.\/markdown["']/g, '"./markdown.js"')
  );
  return js;
}

async function main() {
  const mod = await import(pathToFileURL(compile()).href);
  const {
    SUMMARY_THRESHOLD_CHARS,
    SUMMARY_SOURCE_CHARS,
    SUMMARY_MAX_CHARS,
    needsSummary,
    revisitPreview,
    buildSummarySource,
    clampSummary,
  } = mod;

  console.log("\nthreshold");
  eq("threshold is 600", SUMMARY_THRESHOLD_CHARS, 600);
  eq("empty is not long", needsSummary(""), false);
  eq("null is not long", needsSummary(null), false);
  eq("exactly 600 is NOT over", needsSummary("x".repeat(600)), false);
  eq("601 is over", needsSummary("x".repeat(601)), true);

  console.log("\nrender decision");
  eq("blank content -> empty", revisitPreview("   ", null).mode, "empty");
  eq("blank content ignores a summary", revisitPreview("", "- a").mode, "empty");

  const short = "# Hi\n\nA short hand-written revisit note.";
  eq("short -> raw", revisitPreview(short, null), { mode: "raw", markdown: short });
  ok(
    "short note NEVER shows a summary, even if one exists",
    revisitPreview(short, "- stale bullets").mode === "raw"
  );

  const long = "## Heading\n\n" + "word ".repeat(400);
  eq("long + summary -> summary", revisitPreview(long, "- one\n- two").mode, "summary");
  eq(
    "long + summary is the summary text, not the note",
    revisitPreview(long, "- one\n- two").markdown,
    "- one\n- two"
  );
  eq("long + whitespace-only summary -> fallback", revisitPreview(long, "   ").mode, "fallback");
  eq("long + null summary -> fallback", revisitPreview(long, null).mode, "fallback");

  const fb = revisitPreview(long, null);
  ok("fallback is bounded", fb.text.length <= 221);
  ok("fallback ends with an ellipsis when it truncated", fb.text.endsWith("…"));
  ok("fallback carries no markdown marks", !/[#*_`]/.test(fb.text));

  console.log("\ndigest sent to the model");
  // Shaped like the real rows: dense ## headings over a long body.
  const bigOpening = "## Background\n\n" + "Intro sentence about the topic. ".repeat(80);
  const manyHeadings = Array.from(
    { length: 240 },
    (_, i) => `## Section ${i}\n\n` + "filler ".repeat(60)
  ).join("\n\n");
  const huge = bigOpening + "\n\n" + manyHeadings;
  ok("fixture is genuinely huge", huge.length > 100000);

  const digest = buildSummarySource(huge);
  ok("digest respects its cap", digest.length <= SUMMARY_SOURCE_CHARS);
  ok(
    "digest is a tiny fraction of the note",
    digest.length / huge.length < 0.06
  );
  ok("digest keeps the opening", digest.includes("## Background"));
  ok("digest carries the outline marker", digest.includes("--- Section outline ---"));
  // THE REGRESSION GUARD. The first implementation took the FIRST 70 of the
  // note's 238 headings, so the outline stopped about 30% in and the digest was
  // blind to the rest — the same failure a leading slice has, just further
  // down. Measured on the real 114,787-char note before it was changed.
  //
  // Asserted as PROPERTIES of the sampled outline, not as specific section
  // numbers: which exact indices survive an even stride is an implementation
  // detail, but spanning the document is the contract.
  const outline = digest
    .slice(digest.indexOf("--- Section outline ---"))
    .split("\n")
    .filter((l) => l.startsWith("#"));
  const picked = outline
    .map((l) => /Section (\d+)/.exec(l))
    .filter(Boolean)
    .map((m) => Number(m[1]));

  ok("outline is capped at 70 entries", outline.length <= 70);
  eq("outline keeps the FIRST heading", outline[0], "## Background");
  eq("outline keeps the LAST heading", outline[outline.length - 1], "## Section 239");
  ok(
    "outline reaches far past the leading slice",
    picked.some((n) => n > 100)
  );
  ok(
    "outline spans essentially the whole document",
    Math.max(...picked) - Math.min(...picked) > 0.95 * 239
  );
  const gaps = picked.slice(1).map((n, i) => n - picked[i]);
  ok(
    "no blind stretch — every gap is a handful of sections, not a third of the note",
    Math.max(...gaps) <= 5
  );
  ok(
    "outline does not include filler prose from deep sections",
    !digest.includes("filler filler filler filler filler filler filler")
  );

  const noHeadings = "Just plain prose with no headings at all. ".repeat(300);
  const plainDigest = buildSummarySource(noHeadings);
  ok("heading-free note still yields a digest", plainDigest.length > 100);
  ok("heading-free digest has no outline marker", !plainDigest.includes("--- Section outline ---"));
  ok("heading-free digest respects the cap", plainDigest.length <= SUMMARY_SOURCE_CHARS);

  eq(
    "emphasis marks are stripped from outline entries",
    buildSummarySource("# Top\n\nbody\n\n## **Bold** `code` heading\n").includes(
      "## Bold code heading"
    ),
    true
  );

  // The digest must stay small enough that prompt + max_tokens clears the
  // account's 8,000 TPM reservation. ~4 chars/token is the usual rule of
  // thumb; 5,000 chars is ~1,250 tokens, leaving ample room under the cap.
  ok(
    "digest fits the TPM budget at ~4 chars/token",
    // 1500 = MAX_TOKENS_SUMMARY in lib/ai/client.ts. Prompt + max_tokens is
    // what Groq RESERVES against the 8,000 TPM ceiling, so the digest cap and
    // the output cap have to clear it together.
    SUMMARY_SOURCE_CHARS / 4 + 1500 < 8000
  );

  console.log("\nstored-length clamp");
  // The prompt states the length rule twice and the real notes still came back
  // at 236-503 characters; tightening the wording moved the worst case only
  // from 503 to 475. A length contract expressed in a prompt is a wish. These
  // assertions are the actual contract.
  eq("ceiling is 340", SUMMARY_MAX_CHARS, 340);

  const short3 = "- one\n- two\n- three";
  eq("a short summary is returned untouched", clampSummary(short3), short3);
  eq("surrounding whitespace is trimmed", clampSummary("  " + short3 + "\n "), short3);

  const bullet = (n) => "- " + "word ".repeat(23).trim() + " #" + n;
  const fourBullets = [bullet(1), bullet(2), bullet(3), bullet(4)].join("\n");
  ok("fixture is over the ceiling", fourBullets.length > SUMMARY_MAX_CHARS);

  const clamped = clampSummary(fourBullets);
  ok("clamped result is within the ceiling", clamped.length <= SUMMARY_MAX_CHARS);
  ok("clamp drops WHOLE bullets", clamped.split("\n").every((l) => l.startsWith("- ")));
  ok("clamp never cuts mid-word", /#\d$/.test(clamped));
  ok("clamp keeps the leading bullets", clamped.startsWith(bullet(1)));

  // Two enormous bullets: the two-bullet floor wins over the ceiling, on
  // purpose — one bullet is a headline, not a summary.
  const hugeBullet = "- " + "word ".repeat(80).trim();
  eq(
    "never reduced below two bullets",
    clampSummary(hugeBullet + "\n" + hugeBullet).split("\n").length,
    2
  );

  // Model ignored the bullet format entirely.
  const flat = "word ".repeat(200).trim();
  const flatClamped = clampSummary(flat);
  ok("non-bullet output is still bounded", flatClamped.length <= SUMMARY_MAX_CHARS + 1);
  ok("non-bullet output is marked as truncated", flatClamped.endsWith("…"));
  ok("non-bullet clamp never cuts mid-word", !/w…$|wor…$/.test(flatClamped));

  rmSync(out, { recursive: true, force: true });
  console.log("\n" + (checks - failures) + "/" + checks + " passed");
  if (failures) process.exit(1);
}

main().catch((e) => {
  rmSync(out, { recursive: true, force: true });
  console.error(e);
  process.exit(1);
});
