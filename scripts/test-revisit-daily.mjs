/**
 * Unit checks for the dashboard's one-note-per-day Revisit selection and the
 * bullet-to-paragraph join, both in lib/notes/revisit-summary.ts.
 *
 * These are the whole visible change of that section, and neither can be
 * observed in a browser by an agent: /dashboard/* is behind a login. So they
 * are tested directly — the day rotation against a real IST clock, and the join
 * against summaries shaped like the live corpus.
 *
 * The summary strings below MIRROR the live rows' shape (2-4 "- " bullets,
 * inconsistent terminal punctuation, markdown hard-break trailing spaces) but
 * are not the live rows: the repo is public and these are the user's notes.
 *
 * Run:  node scripts/test-revisit-daily.mjs
 *
 * Compiles with the project's own `typescript` devDependency — no test runner,
 * matching scripts/test-revisit-summary.mjs.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const out = mkdtempSync(path.join(tmpdir(), "prism-revisit-daily-"));
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
  // revisit-summary imports markdownExcerpt; the day index comes from lib/date.
  // Rewrite the "@/" aliases to sibling ESM specifiers — there is no tsconfig
  // in the temp dir to resolve them.
  const srcs = ["lib/markdown.ts", "lib/date.ts", "lib/notes/revisit-summary.ts"];
  for (const rel of srcs) {
    const text = readFileSync(path.join(root, rel), "utf8").replace(
      /["']@\/lib\/markdown["']/g,
      '"./markdown.js"'
    );
    writeFileSync(path.join(out, path.basename(rel)), text);
  }
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules", "typescript", "bin", "tsc"),
      "--target", "ES2019",
      "--module", "ES2020",
      "--moduleResolution", "node",
      "--skipLibCheck",
      "--outDir", out,
      ...srcs.map((s) => path.join(out, path.basename(s))),
    ],
    { stdio: "inherit" }
  );
  writeFileSync(
    path.join(out, "package.json"),
    JSON.stringify({ type: "module" })
  );
  return Promise.all([
    import(pathToFileURL(path.join(out, "revisit-summary.js")).href),
    import(pathToFileURL(path.join(out, "date.js")).href),
  ]);
}

const [revisit, dateLib] = await compile();
const { dailyRevisitIndex, summaryParagraph, SUMMARY_MAX_CHARS } = revisit;
const { istDayNumber } = dateLib;

// ── day selection ────────────────────────────────────────────────────────
console.log("\ndailyRevisitIndex — determinism within one IST date");
{
  // Every instant inside one IST civil day, from its first millisecond to its
  // last. 2026-09-03 IST starts at 2026-09-02T18:30:00Z and ends one ms before
  // 2026-09-03T18:30:00Z.
  const dayStart = Date.parse("2026-09-02T18:30:00.000Z");
  const dayEnd = Date.parse("2026-09-03T18:29:59.999Z");
  const at = (ms) => dailyRevisitIndex(istDayNumber(ms), 13);

  const first = at(dayStart);
  ok("index is a number", typeof first === "number");
  eq("00:00:00.000 IST", at(dayStart), first);
  eq("05:29 IST (before the UTC-day boundary)", at(dayStart + 5 * 3600_000), first);
  eq("05:30 IST (the UTC-day boundary itself)", at(dayStart + 5.5 * 3600_000), first);
  eq("06:00 IST (just after it)", at(dayStart + 6 * 3600_000), first);
  eq("12:00 IST", at(dayStart + 12 * 3600_000), first);
  eq("23:59:59.999 IST", at(dayEnd), first);
  // The failure this guards against: a UTC-derived day index changes at
  // 05:30 IST, mid-morning, while the note is being read.
  const utcDay = (ms) => Math.floor(ms / 86_400_000);
  ok(
    "a UTC day index WOULD have flipped at 05:30 IST",
    dailyRevisitIndex(utcDay(dayStart + 5 * 3600_000), 13) !==
      dailyRevisitIndex(utcDay(dayStart + 6 * 3600_000), 13)
  );
}

console.log("\ndailyRevisitIndex — the boundary is IST midnight");
{
  const lastMsOfSep2 = Date.parse("2026-09-02T18:29:59.999Z");
  const firstMsOfSep3 = Date.parse("2026-09-02T18:30:00.000Z");
  ok(
    "index changes across IST midnight",
    dailyRevisitIndex(istDayNumber(lastMsOfSep2), 13) !==
      dailyRevisitIndex(istDayNumber(firstMsOfSep3), 13)
  );
  eq(
    "and it is exactly one step",
    dailyRevisitIndex(istDayNumber(firstMsOfSep3), 13),
    (dailyRevisitIndex(istDayNumber(lastMsOfSep2), 13) + 1) % 13
  );
}

console.log("\ndailyRevisitIndex — consecutive days differ when count > 1");
{
  const base = istDayNumber(Date.parse("2026-09-03T06:00:00.000Z"));
  for (const count of [2, 3, 5, 13]) {
    const seen = [];
    for (let d = 0; d < count; d++) {
      seen.push(dailyRevisitIndex(base + d, count));
    }
    eq(
      `count ${count}: no two consecutive days repeat`,
      seen.some((v, i) => i > 0 && v === seen[i - 1]),
      false
    );
    eq(
      `count ${count}: one full cycle visits every note exactly once`,
      seen.slice().sort((a, b) => a - b),
      Array.from({ length: count }, (_, i) => i)
    );
    eq(
      `count ${count}: the cycle repeats`,
      dailyRevisitIndex(base + count, count),
      dailyRevisitIndex(base, count)
    );
  }
}

console.log("\ndailyRevisitIndex — degenerate counts");
{
  eq("count 0 -> null (section omits itself)", dailyRevisitIndex(20_000, 0), null);
  eq("negative count -> null", dailyRevisitIndex(20_000, -3), null);
  eq("NaN count -> null", dailyRevisitIndex(20_000, NaN), null);
  // A single note shows every day. No special case in the caller.
  const single = [20_000, 20_001, 20_002, 20_003].map((d) =>
    dailyRevisitIndex(d, 1)
  );
  eq("count 1 -> always index 0", single, [0, 0, 0, 0]);
  // A device clock set before 1970 yields a negative day index; `%` keeps the
  // sign of the dividend, so a single modulo would index out of the array.
  eq("negative day index stays in range", dailyRevisitIndex(-1, 13), 12);
  eq("index is always < count", dailyRevisitIndex(-40, 13) < 13, true);
  eq("index is always >= 0", dailyRevisitIndex(-40, 13) >= 0, true);
}

// ── bullet -> paragraph ──────────────────────────────────────────────────
console.log("\nsummaryParagraph — markers, spacing, punctuation");
{
  eq(
    "leading '- ' markers are removed",
    summaryParagraph("- one\n- two"),
    "one. two."
  );
  eq(
    "'* ' markers too",
    summaryParagraph("* one\n* two"),
    "one. two."
  );
  eq(
    "a bullet that already ends in a full stop gains no second one",
    summaryParagraph("- Ends here.\n- And here"),
    "Ends here. And here."
  );
  eq(
    "other terminal punctuation is respected",
    summaryParagraph("- Really?\n- Yes!\n- Wait…\n- Namely:\n- done"),
    "Really? Yes! Wait… Namely: done."
  );
  eq(
    "markdown hard-break trailing spaces do not become double spaces",
    summaryParagraph("- one  \n- two  "),
    "one. two."
  );
  eq(
    "internal whitespace runs collapse to one space",
    summaryParagraph("- one   two\tthree"),
    "one two three."
  );
  eq("blank lines are dropped", summaryParagraph("- one\n\n- two"), "one. two.");
  eq("empty input -> empty string", summaryParagraph(""), "");
  eq("whitespace-only input -> empty string", summaryParagraph("   \n  "), "");
  eq(
    "non-bullet text passes through as one unit",
    summaryParagraph("Just a sentence with no marker"),
    "Just a sentence with no marker."
  );
  eq(
    "clampSummary's ellipsis fallback keeps its ellipsis, gains no full stop",
    summaryParagraph("A truncated line that ends in an ellipsis…"),
    "A truncated line that ends in an ellipsis…"
  );
  eq(
    "output contains no double space",
    summaryParagraph("- a  \n-  b  c  \n- d").indexOf("  "),
    -1
  );
}

console.log("\nsummaryParagraph — length, against live-shaped summaries");
{
  // Shaped like the real rows: 2-4 bullets, 236-338 chars total, mixed
  // terminal punctuation, some with markdown hard-break trailing spaces.
  const corpus = [
    "- Overview of eight free tools, positioned as replacements for paid alternatives.\n" +
      "- Capabilities span market research, image and video creation, site building, and automated tasks, with a deep-research feature that compiles multi-site reports across dozens of sources.",
    "- Visualization is a receptive state, not a forced daily exercise  \n" +
      "- Desire plus non-resistance (clear belief, calm nervous system) yields results  \n" +
      "- All possibilities already exist; the work is learning to perceive them  \n" +
      "- Silence, presence and a down-regulated nervous system unlock the vision",
    "- Leveraging AI tooling to launch a solo venture  \n" +
      "- Low global adoption creates a large market for AI-powered services  \n" +
      "- Practical steps: job acquisition, a sales-call framework, building and deploying apps  \n" +
      "- Strategies for scaling while balancing a day job",
    "- A single long bullet with no terminal punctuation and nothing else to join it to, which is the two-bullet-floor shape clampSummary can emit",
  ];

  for (const [i, summary] of corpus.entries()) {
    const para = summaryParagraph(summary);
    ok(`[${i}] output is a single line`, para.indexOf("\n") === -1);
    ok(`[${i}] no double space`, para.indexOf("  ") === -1);
    ok(`[${i}] no leading marker survives`, !/(^|\s)[-*]\s/.test(para));
    ok(`[${i}] ends in terminal punctuation`, /[.!?…:;]$/.test(para));
    // The join removes 2 chars per bullet and adds at most 1, and each newline
    // becomes one space, so it can never grow past what was stored.
    ok(
      `[${i}] never longer than the stored summary (${para.length} <= ${summary.length})`,
      para.length <= summary.length
    );
    ok(
      `[${i}] within SUMMARY_MAX_CHARS (${para.length} <= ${SUMMARY_MAX_CHARS})`,
      para.length <= SUMMARY_MAX_CHARS
    );
  }
}

// ── the null-summary fallback still routes to the excerpt path ────────────
console.log("\nnull summary falls through to the excerpt path, not to an AI call");
{
  const { revisitPreview, FALLBACK_EXCERPT_CHARS } = revisit;
  const long = "# Heading\n\n" + "word ".repeat(400);

  eq("long + null summary -> fallback", revisitPreview(long, null).mode, "fallback");
  eq(
    "long + whitespace-only summary -> fallback",
    revisitPreview(long, "   ").mode,
    "fallback"
  );
  const fb = revisitPreview(long, null);
  ok("fallback is plain text, not markdown", !("markdown" in fb));
  ok(
    `fallback is bounded (<= ${FALLBACK_EXCERPT_CHARS} + ellipsis)`,
    fb.text.length <= FALLBACK_EXCERPT_CHARS + 1
  );
  ok("fallback is a single line", fb.text.indexOf("\n") === -1);
  // The summary branch is still the one that gets the paragraph treatment.
  eq(
    "long + summary -> summary mode (paragraph branch)",
    revisitPreview(long, "- one\n- two").mode,
    "summary"
  );
}

console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED` : "")
);
process.exit(failures ? 1 : 0);
