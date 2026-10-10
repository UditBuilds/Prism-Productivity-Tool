/**
 * Send the meaning check's test set (scripts/judge-cases.json) to the REAL
 * G2 judge — lib/learning/judge.ts, strict JSON, each group's explanation
 * sent exactly as the lesson job sends it — on gpt-oss-20b and gpt-oss-120b,
 * and score both: each scored sentence's verdict, and the unexplained words
 * each group must and must not report.
 *
 * This SPENDS Groq tokens on the live app's account (a few thousand per
 * model per run), so it is not part of `npm test` (which only runs
 * scripts/test-*.mjs). The key is read from .env.local on purpose: the shell
 * may hold a different key, on the same account. A 429 is waited out
 * (Retry-After) and tried again, at most three times.
 *
 * Run:  node scripts/eval-judge.mjs            (both models)
 *       node scripts/eval-judge.mjs 120b       (one)
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const out = mkdtempSync(path.join(tmpdir(), "prism-judge-eval-"));
const MODULES = ["constants", "answers", "net-guard", "html-text", "sources", "passages", "explanation", "judge"];
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
const answers = await import(pathToFileURL(path.join(out, "answers.js")).href);
const explanation = await import(pathToFileURL(path.join(out, "explanation.js")).href);
const { JUDGE_MAX_TOKENS } = await import(pathToFileURL(path.join(out, "constants.js")).href);

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

const MODELS = { "20b": "openai/gpt-oss-20b", "120b": "openai/gpt-oss-120b" };
const which = process.argv[2] ? [process.argv[2]] : ["20b", "120b"];
const set = JSON.parse(readFileSync(path.join(root, "scripts", "judge-cases.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(model, body) {
  for (let tries = 0; ; tries++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, ...body }),
    });
    const json = await res.json();
    if (res.status === 429 && tries < 3) {
      const wait = Math.ceil(Number(res.headers.get("retry-after") ?? "20")) + 1;
      console.log(`    (429 on ${model}: waiting ${wait}s)`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 600)}`);
    return json;
  }
}

const summary = [];
for (const key of which) {
  const model = MODELS[key];
  if (!model) throw new Error(`unknown model ${key}; use 20b or 120b`);
  console.log(`\n━━ ${model}`);
  let tokens = 0;
  let verdictsOk = 0;
  let verdictsAll = 0;
  let wordsOk = 0;
  let wordsAll = 0;
  for (const group of set.groups) {
    const sentences = group.cases.map((c, i) => ({
      id: i + 1,
      text: c.sentence,
      part: c.closing ? "closing" : c.line ? "walkthrough" : "meaning",
      line: c.line ?? null,
    }));
    const body = await call(model, {
      messages: [
        { role: "system", content: judge.JUDGE_SYSTEM_PROMPT },
        { role: "user", content: judge.judgeUserMessage(group.source, sentences) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "verdicts", strict: true, schema: judge.JUDGE_SCHEMA } },
      reasoning_effort: "low",
      temperature: 0,
      max_tokens: JUDGE_MAX_TOKENS,
    });
    tokens += body.usage?.total_tokens ?? 0;
    const answer = answers.readAnswer(body.choices?.[0]?.message?.content ?? "", judge.JUDGE_SCHEMA, "the meaning check's answer");
    const read = judge.readVerdicts(answer, sentences, group.source, sentences);
    if ("bad" in read) {
      console.log(`  group ${group.name}: the answer could not be used: ${read.bad}`);
      verdictsAll += group.cases.filter((c) => c.expect).length;
      continue;
    }
    console.log(`  ${group.name} (${body.usage?.total_tokens ?? 0} tokens)`);
    group.cases.forEach((c, i) => {
      if (!c.expect) return;
      const v = answer.verdicts.find((x) => x.id === i + 1);
      const got = v?.verdict ?? "none";
      const pass = got === c.expect || (c.accept ?? []).includes(got);
      verdictsAll += 1;
      if (pass) verdictsOk += 1;
      console.log(`    ${pass ? "ok  " : "MISS"} ${c.id.padEnd(40)} expect ${c.expect.padEnd(11)} got ${got.padEnd(11)}${v?.reason ? ` ${v.reason}` : ""}`);
    });
    const listed = read.words.map((w) => w.word).concat(read.dropped);
    if (group.words) {
      for (const w of group.words.include) {
        const pass = listed.some((x) => explanation.mentionsWord(x, w) || explanation.mentionsWord(w, x));
        wordsAll += 1;
        if (pass) wordsOk += 1;
        console.log(`    ${pass ? "ok  " : "MISS"} unexplained word must be listed: ${w}`);
      }
      for (const w of group.words.exclude) {
        const pass = !listed.some((x) => explanation.mentionsWord(x, w) || explanation.mentionsWord(w, x));
        wordsAll += 1;
        if (pass) wordsOk += 1;
        console.log(`    ${pass ? "ok  " : "MISS"} explained word must NOT be listed: ${w}`);
      }
    }
    console.log(`    unexplained words it listed: ${listed.length ? listed.join(", ") : "(none)"}`);
  }
  const line = `${model}: verdicts ${verdictsOk}/${verdictsAll}, words ${wordsOk}/${wordsAll}, ${tokens} tokens`;
  summary.push(line);
  console.log(`\n${line}`);
}
console.log(`\n━━ summary\n${summary.join("\n")}`);
