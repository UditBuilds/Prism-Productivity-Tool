/**
 * Send the judge's test set (scripts/judge-cases.json) to the REAL meaning
 * check (lib/learning/judge.ts on gpt-oss-20b) and compare its verdicts with
 * the expected ones.
 *
 * This SPENDS Groq tokens on the live app's account (about 1,500 on 20b per
 * run), so it is not part of `npm test` (which only runs scripts/test-*.mjs).
 * The key is read from .env.local on purpose: the shell may hold a different
 * key, on the same account.
 *
 * Run:  node scripts/eval-judge.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const out = mkdtempSync(path.join(tmpdir(), "prism-judge-eval-"));
const MODULES = ["constants", "net-guard", "html-text", "sources", "passages", "lesson-format", "judge"];
const files = MODULES.map((name) => {
  const text = readFileSync(path.join(root, "lib", "learning", `${name}.ts`), "utf8").replace(
    /["']@\/lib\/learning\/([a-z-]+)["']/g,
    '"./$1.js"'
  );
  const file = path.join(out, `${name}.ts`);
  writeFileSync(file, text);
  return file;
});
execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules", "typescript", "bin", "tsc"),
    "--target", "ES2020", "--module", "ES2020", "--moduleResolution", "node",
    "--skipLibCheck", "--strict", "--esModuleInterop", "--types", "node", "--typeRoots", path.join(root, "node_modules", "@types"),
    "--outDir", out,
    ...files,
  ],
  { stdio: "inherit" }
);
writeFileSync(path.join(out, "package.json"), JSON.stringify({ type: "module" }));
const judge = await import(pathToFileURL(path.join(out, "judge.js")).href);
const { LEARNING_JUDGE_MODEL } = await import(pathToFileURL(path.join(out, "constants.js")).href);

const env = Object.fromEntries(
  readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);
if (!env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not in .env.local");

const set = JSON.parse(readFileSync(path.join(root, "scripts", "judge-cases.json"), "utf8"));
const teach = (text) => ({ kind: "teach", text, cites: [], term: null, codeLines: null });
let total = 0;
const rows = [];
for (const group of set.groups) {
  const passages = group.passages.map((p) => ({ id: p.id, source: 1, kind: p.kind, text: p.text }));
  const lesson = { title: "", summary: "", dropped: [], items: group.lessonSoFar.map((t) => ({ type: "line", line: teach(t) })) };
  const items = group.cases.map((c, i) => ({
    id: i + 1,
    line: c.kind === "close" ? group.lessonSoFar.length + 1 : i + 1,
    kind: c.kind,
    sentence: c.sentence,
    cites: c.cites ?? [],
    term: c.term ?? null,
    code: c.code ?? null,
  }));
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LEARNING_JUDGE_MODEL,
      messages: [
        { role: "system", content: judge.JUDGE_SYSTEM_PROMPT },
        { role: "user", content: judge.judgeUserMessage(lesson, passages, items) },
      ],
      reasoning_effort: "low",
      temperature: 0,
      max_tokens: 2000,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`HTTP ${res.status}:`, JSON.stringify(body.error ?? body).slice(0, 400));
    process.exit(1);
  }
  total += body.usage?.total_tokens ?? 0;
  const verdicts = judge.parseVerdicts(body.choices?.[0]?.message?.content ?? "", items.map((i) => i.id));
  group.cases.forEach((c, i) => {
    const v = verdicts.get(i + 1);
    rows.push({ id: c.id, layer: c.layer, expect: c.expect, got: v.ok ? "YES" : "NO", why: v.why });
  });
}

for (const r of rows) {
  const mark = r.expect === r.got ? "ok  " : "MISS";
  console.log(`${mark} ${r.id.padEnd(44)} expect ${r.expect}  got ${r.got}  [${r.layer}]${r.why ? `  ${r.why}` : ""}`);
}
const misses = rows.filter((r) => r.expect !== r.got);
console.log(`\n${rows.length - misses.length}/${rows.length} as expected; ${total} tokens on ${LEARNING_JUDGE_MODEL}`);
for (const m of misses) {
  console.log(`  miss: ${m.id} (${m.layer === "code" ? "caught by a code rule instead" : "the judge must catch this"})`);
}
process.exit(misses.some((m) => m.layer === "judge") ? 1 : 0);
