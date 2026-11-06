/**
 * Unit checks for lib/auth/safe-next.ts — the one rule for where a "next"
 * parameter may send someone (auth callback, /login, middleware).
 *
 * The bug it replaced: /api/auth/callback built its redirect as
 * `${origin}${next}`, and `next=@evil.example` turns that into
 * "https://site@evil.example" — a URL whose HOST is evil.example.
 *
 * Every hostile case must come back as /dashboard, and EVERY result — hostile
 * or not — must resolve to the site's own origin and must not be
 * protocol-relative. Those two invariants are checked for all cases below,
 * not just the ones labelled hostile.
 *
 * Run:  node scripts/test-safe-next.mjs
 *
 * Compiles with the project's own `typescript` devDependency — no test runner,
 * matching the other scripts/test-*.mjs.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const out = mkdtempSync(path.join(tmpdir(), "prism-safe-next-"));
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

function compile() {
  const rel = "lib/auth/safe-next.ts";
  writeFileSync(
    path.join(out, path.basename(rel)),
    readFileSync(path.join(root, rel), "utf8")
  );
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules", "typescript", "bin", "tsc"),
      "--target", "ES2019",
      "--module", "ES2020",
      "--moduleResolution", "node",
      "--skipLibCheck",
      "--outDir", out,
      path.join(out, path.basename(rel)),
    ],
    { stdio: "inherit" }
  );
  writeFileSync(
    path.join(out, "package.json"),
    JSON.stringify({ type: "module" })
  );
  return import(pathToFileURL(path.join(out, "safe-next.js")).href);
}

const { safeNextPath, DEFAULT_NEXT_PATH } = await compile();

// Two origins: the production shape, and the local test shape with a port.
const ORIGINS = [
  "https://prism-productivity-tool.vercel.app",
  "http://127.0.0.1:3101",
];

eq("DEFAULT_NEXT_PATH is /dashboard", DEFAULT_NEXT_PATH, "/dashboard");

/** [label, input, expected] */
const cases = [
  // ── the brief's required list ──────────────────────────────────────
  ["@evil.example (the original bug)", "@evil.example", "/dashboard"],
  ["//evil.example (protocol-relative)", "//evil.example", "/dashboard"],
  ["/\\evil.example (backslash read as slash)", "/\\evil.example", "/dashboard"],
  ["https://evil.example (absolute, other host)", "https://evil.example", "/dashboard"],
  ["%2F%2Fevil.example (encoded, no leading slash)", "%2F%2Fevil.example", "/dashboard"],
  ["/\\t/evil.example (tab the parser would strip)", "/\t/evil.example", "/dashboard"],
  ["/dash\\nboard (newline)", "/dash\nboard", "/dashboard"],
  ["/x\\r/evil.example (carriage return)", "/x\r/evil.example", "/dashboard"],
  ["empty string", "", "/dashboard"],
  ["null", null, "/dashboard"],
  ["undefined", undefined, "/dashboard"],
  ["/dashboard", "/dashboard", "/dashboard"],
  [
    "/oauth/consent?authorization_id=abc survives intact",
    "/oauth/consent?authorization_id=abc",
    "/oauth/consent?authorization_id=abc",
  ],

  // ── bypasses the origin check alone does not catch ─────────────────
  ["/.//evil.example (dot segment → //evil.example)", "/.//evil.example", "/dashboard"],
  ["/./\\evil.example (dot + backslash)", "/./\\evil.example", "/dashboard"],
  ["/\\/evil.example", "/\\/evil.example", "/dashboard"],
  ["javascript:alert(1)", "javascript:alert(1)", "/dashboard"],
  ["https://prism-productivity-tool.vercel.app/x (absolute, even same host)", "https://prism-productivity-tool.vercel.app/x", "/dashboard"],
  [" /dashboard/tasks (leading space)", " /dashboard/tasks", "/dashboard"],

  // ── auth pages would only bounce ───────────────────────────────────
  ["/login", "/login", "/dashboard"],
  ["/login?next=/dashboard/tasks", "/login?next=/dashboard/tasks", "/dashboard"],
  ["/signup", "/signup", "/dashboard"],

  // ── legitimate destinations keep path, query and hash ──────────────
  ["/dashboard/tasks?filter=today#top", "/dashboard/tasks?filter=today#top", "/dashboard/tasks?filter=today#top"],
  [
    "/oauth/consent with a 32-char alphanumeric id",
    "/oauth/consent?authorization_id=aZ09aZ09aZ09aZ09aZ09aZ09aZ09aZ09",
    "/oauth/consent?authorization_id=aZ09aZ09aZ09aZ09aZ09aZ09aZ09aZ09",
  ],
  // Same-origin path whose SEGMENT is percent-encoded: it stays encoded, so it
  // is a path on this site (a 404), never a protocol-relative URL.
  ["/%2F%2Fevil.example stays an encoded same-site path", "/%2F%2Fevil.example", "/%2F%2Fevil.example"],
  // Encoded CR/LF stays encoded — no header injection through Location.
  ["/%0d%0aSet-Cookie:x stays encoded", "/%0d%0aSet-Cookie:x", "/%0d%0aSet-Cookie:x"],
];

for (const origin of ORIGINS) {
  console.log(`\norigin ${origin}`);
  for (const [label, input, expected] of cases) {
    const result = safeNextPath(input, origin);
    eq(label, result, expected);

    // Invariants, for every case: same origin, not protocol-relative, no
    // raw control characters.
    checks++;
    const resolved = new URL(result, origin);
    const ok =
      resolved.origin === new URL(origin).origin &&
      result.startsWith("/") &&
      !result.startsWith("//") &&
      !result.startsWith("/\\") &&
      !/[\u0000-\u001F\u007F]/.test(result);
    if (!ok) {
      failures++;
      console.log(`  FAIL  invariant broken for ${label}: ${JSON.stringify(result)}`);
    }
  }
}

console.log("\nthe old code, for contrast (not the helper — what master did)");
eq(
  "`${origin}${next}` with next=@evil.example resolves to host evil.example",
  new URL(`https://prism-productivity-tool.vercel.app${"@evil.example"}`).host,
  "evil.example"
);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
