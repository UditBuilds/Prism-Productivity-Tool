/**
 * Run every scripts/test-*.mjs, one after another, and fail if any fails.
 *
 * Discovered by filename rather than listed, so a new test file is in CI the
 * moment it exists — the suite had grown to 260 checks across six files while
 * CI ran none of them.
 *
 * Run:  npm test        (or: node scripts/run-tests.mjs)
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "scripts");
const tests = readdirSync(dir)
  .filter((f) => /^test-.*\.mjs$/.test(f))
  .sort();

const results = [];
for (const file of tests) {
  console.log(`\n━━ ${file}`);
  const started = Date.now();
  const { status } = spawnSync(process.execPath, [path.join("scripts", file)], {
    stdio: "inherit",
  });
  results.push({ file, ok: status === 0, ms: Date.now() - started });
}

console.log("\n━━ summary");
for (const r of results) {
  console.log(`  ${r.ok ? "pass" : "FAIL"}  ${r.file}  (${r.ms} ms)`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} test files passed`);
if (failed.length > 0 || results.length === 0) process.exit(1);
