/**
 * ONE-OFF: generate `notes.summary` for the Revisit notes that predate the
 * summary feature.
 *
 * This is NOT a standing code path. Summaries are written on save
 * (app/api/notes/route.ts); this exists only because the rows that exposed the
 * dashboard bug were created before that code did, and filling them needs live
 * LLM calls per note — which is why it is a script and not SQL.
 *
 * SAFETY
 * - Dry run by default. It prints the exact work and the token estimate and
 *   writes NOTHING unless you pass --apply.
 * - It only ever touches rows where `summary IS NULL`, so a re-run cannot
 *   overwrite a summary that already exists, and an interrupted run resumes
 *   simply by being run again.
 * - It writes ONLY the `summary` column. Title, content, tags, kind and
 *   updated_at are untouched — a backfill must not reorder the user's notes.
 *
 * RATE LIMIT
 * The Groq account is free tier: 8,000 tokens/minute, account-wide, and the
 * reservation is `prompt_tokens + max_tokens`, not actual usage. The script
 * keeps a rolling 60-second ledger of reserved tokens and waits rather than
 * eating a 429 — a refused call here would leave a row unfilled for no reason.
 *
 * Run:
 *   node scripts/backfill-note-summaries.mjs            # dry run, no writes
 *   node scripts/backfill-note-summaries.mjs --apply    # writes summaries
 *   node scripts/backfill-note-summaries.mjs --apply --limit=1   # largest only
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const APPLY = process.argv.includes("--apply");
/**
 * --limit=N takes the N LARGEST unsummarized notes rather than an arbitrary N.
 * A partial run should exercise the worst case first: the 114,787-character
 * note is the one that can actually reveal a bad digest or a truncated answer,
 * so proving it on a small note would prove nothing.
 */
const LIMIT = (() => {
  const arg = process.argv.find((a) => a.startsWith("--limit="));
  return arg ? Math.max(1, Number(arg.slice("--limit=".length)) || 1) : null;
})();

/** Same cap as lib/ai/client.ts's MAX_TOKENS_SUMMARY. Keep them in step. */
const MAX_TOKENS_SUMMARY = 1500;
const MODEL = "openai/gpt-oss-120b";
/** Stay under the 8,000 TPM ceiling with room for anything else on the key. */
const TPM_BUDGET = 6500;

function env(name) {
  const line = readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(name + "="));
  if (!line) throw new Error(name + " missing from .env.local");
  return line
    .slice(name.length + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
}

/** Compile the real helper so the digest is byte-identical to production. */
function loadHelper() {
  const out = mkdtempSync(path.join(tmpdir(), "prism-backfill-"));
  for (const rel of ["lib/markdown.ts", "lib/notes/revisit-summary.ts"]) {
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
      "--target",
      "es2019",
      "--module",
      "es2020",
      "--moduleResolution",
      "node",
      "--skipLibCheck",
      path.join(out, "markdown.ts"),
      path.join(out, "revisit-summary.ts"),
    ],
    { stdio: "inherit" }
  );
  const js = path.join(out, "revisit-summary.js");
  writeFileSync(
    js,
    readFileSync(js, "utf8").replace(/["']\.\/markdown["']/g, '"./markdown.js"')
  );
  return {
    url: pathToFileURL(js).href,
    cleanup: () => rmSync(out, { recursive: true, force: true }),
  };
}

// Mirrors the system prompt in lib/ai/client.ts summarizeNoteContent(). Kept
// as a literal copy rather than imported: that module constructs a Groq client
// at import time from process.env, which a plain node script has no business
// booting just to read a string.
const SYSTEM_PROMPT = [
  'You write ultra-short "what is this about" summaries of study notes, so someone scanning a dashboard can tell what a note covers without opening it.',
  "",
  "Rules:",
  '- Output 2 to 4 Markdown bullet points, each starting with "- ". Nothing else: no heading, no preamble, no closing line, no code fence.',
  "- LENGTH IS THE HARDEST RULE: the whole summary must be 150-300 characters and must never exceed 340. Count as you go. Each bullet is a short phrase of roughly 60-90 characters — one clause, no padding, no sub-clauses after a semicolon.",
  "- State what the note is ABOUT and its main takeaways. Do not recap it section by section.",
  '- You may be given the note\'s opening followed by a "--- Section outline ---" list of its headings. The outline tells you the note\'s full scope; use it so the summary covers the whole note, not only the opening.',
  "- Never mention 'the note', 'this document', 'the outline', 'the video', or 'the speaker'.",
  "- Plain text inside bullets. No bold, no links, no nested bullets.",
  "- Do not invent anything the source does not support.",
].join("\n");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Rolling 60s ledger of RESERVED tokens (prompt + max_tokens). */
const ledger = [];
async function reserve(tokens) {
  for (;;) {
    const cutoff = Date.now() - 60000;
    while (ledger.length && ledger[0].t < cutoff) ledger.shift();
    const used = ledger.reduce((n, e) => n + e.n, 0);
    if (used + tokens <= TPM_BUDGET) {
      ledger.push({ t: Date.now(), n: tokens });
      return;
    }
    const waitMs = ledger[0].t + 60000 - Date.now() + 500;
    console.log(
      "      ... TPM budget reached (" +
        used +
        " reserved), waiting " +
        Math.ceil(waitMs / 1000) +
        "s"
    );
    await sleep(Math.max(waitMs, 1000));
  }
}

async function main() {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const groqKey = env("GROQ_API_KEY");
  if (Object.hasOwn(process.env, "GROQ_API_KEY")) {
    console.log(
      "NOTE: an ambient GROQ_API_KEY is set in this shell. This script reads " +
        ".env.local directly and ignores it."
    );
  }

  const { url: helperUrl, cleanup } = loadHelper();
  const { buildSummarySource, needsSummary, SUMMARY_THRESHOLD_CHARS } =
    await import(helperUrl);

  const headers = { apikey: key, Authorization: "Bearer " + key };
  const res = await fetch(
    url +
      "/rest/v1/notes?select=id,title,content&kind=eq.revisit&summary=is.null",
    { headers }
  );
  if (!res.ok) throw new Error("Supabase read failed: " + res.status);
  const rows = await res.json();

  const eligible = rows
    .filter((n) => needsSummary(n.content ?? ""))
    .sort((a, b) => (b.content ?? "").length - (a.content ?? "").length);
  const skipped = rows.length - eligible.length;
  const targets = LIMIT ? eligible.slice(0, LIMIT) : eligible;

  console.log("\nRevisit notes with summary NULL: " + rows.length);
  console.log(
    "Over the " + SUMMARY_THRESHOLD_CHARS + "-char threshold: " + eligible.length
  );
  if (skipped) console.log("Under threshold, no call needed: " + skipped);
  if (LIMIT) {
    console.log(
      "--limit=" + LIMIT + " -> processing the " + targets.length +
        " largest; " + (eligible.length - targets.length) + " left for a later run."
    );
  }

  let estPrompt = 0;
  for (const n of targets) {
    const src = buildSummarySource(n.content ?? "");
    // ~4 chars/token, plus the system prompt and the title line.
    estPrompt += Math.ceil(
      (src.length + SYSTEM_PROMPT.length + n.title.length) / 4
    );
  }
  const reserved = estPrompt + targets.length * MAX_TOKENS_SUMMARY;
  console.log(
    "\nESTIMATE - " +
      targets.length +
      " calls, ~" +
      estPrompt +
      " prompt tokens, " +
      targets.length * MAX_TOKENS_SUMMARY +
      " reserved for output (worst case ~" +
      reserved +
      " reserved total)."
  );

  if (!APPLY) {
    console.log("\nDRY RUN - nothing written. Re-run with --apply to execute.\n");
    targets.forEach((n, i) =>
      console.log(
        "  " +
          String(i + 1).padStart(2) +
          ". " +
          String((n.content ?? "").length).padStart(7) +
          " chars  " +
          n.title.slice(0, 56)
      )
    );
    cleanup();
    return;
  }

  let done = 0;
  let failed = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let reasoningTokens = 0;

  for (const [i, note] of targets.entries()) {
    const source = buildSummarySource(note.content ?? "");
    const label = i + 1 + "/" + targets.length + " " + note.title.slice(0, 48);
    const estimate =
      Math.ceil((source.length + SYSTEM_PROMPT.length) / 4) + MAX_TOKENS_SUMMARY;
    await reserve(estimate);

    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + groqKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content:
                "Title: " + note.title.slice(0, 300) + "\n\nNote:\n" + source,
            },
          ],
          temperature: 0.3,
          max_tokens: MAX_TOKENS_SUMMARY,
          // See lib/ai/client.ts: at the default effort, reasoning tokens ate
          // the whole cap and returned empty content on half the real notes.
          reasoning_effort: "low",
        }),
      });

      const body = await r.json();
      if (!r.ok) {
        throw new Error(r.status + " " + JSON.stringify(body).slice(0, 200));
      }

      const choice = body.choices?.[0];
      if (choice?.finish_reason === "length") throw new Error("output truncated");
      const summary = (choice?.message?.content ?? "").trim();
      if (!summary) throw new Error("empty completion");

      promptTokens += body.usage?.prompt_tokens ?? 0;
      completionTokens += body.usage?.completion_tokens ?? 0;
      reasoningTokens +=
        body.usage?.completion_tokens_details?.reasoning_tokens ?? 0;

      // summary ONLY. No updated_at - a backfill must not reorder the notes.
      const w = await fetch(url + "/rest/v1/notes?id=eq." + note.id, {
        method: "PATCH",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ summary }),
      });
      if (!w.ok) {
        throw new Error("write failed " + w.status + " " + (await w.text()));
      }

      done++;
      console.log("  ok    " + label + "  (" + summary.length + " chars)");
    } catch (err) {
      failed++;
      console.log("  FAIL  " + label + "\n        " + err.message);
    }
  }

  console.log(
    "\n" +
      done +
      " written, " +
      failed +
      " failed.\nTOKENS - prompt " +
      promptTokens +
      ", completion " +
      completionTokens +
      " (of which reasoning " +
      reasoningTokens +
      "), total " +
      (promptTokens + completionTokens) +
      "."
  );
  cleanup();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
