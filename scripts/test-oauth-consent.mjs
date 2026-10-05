/**
 * Unit checks for lib/oauth/consent.ts — the pure rules behind the OAuth
 * approval page (app/(auth)/oauth/consent).
 *
 * The two that carry security weight:
 *  - isValidAuthorizationId: auth-js pastes the id into the Auth API path
 *    unencoded, so "../" or "?" in it would redirect the signed-in user's
 *    token to another Auth endpoint.
 *  - isSafeRedirectUrl: the page only ever navigates to Supabase's
 *    redirect_url, and even that must be http(s).
 *
 * Run:  node scripts/test-oauth-consent.mjs
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
const out = mkdtempSync(path.join(tmpdir(), "prism-oauth-consent-"));
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
  const rel = "lib/oauth/consent.ts";
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
  return import(pathToFileURL(path.join(out, "consent.js")).href);
}

const {
  CONSENT_PATH,
  isValidAuthorizationId,
  consentPathFor,
  isSafeRedirectUrl,
  redirectHostname,
  classifyConsentError,
  isBackgroundPageFetch,
} = await compile();

eq("CONSENT_PATH is /oauth/consent", CONSENT_PATH, "/oauth/consent");

console.log("\nisValidAuthorizationId");
const realShape = "aZ09aZ09aZ09aZ09aZ09aZ09aZ09aZ09"; // 32 alphanumerics, as Supabase makes
eq("32 alphanumerics (Supabase's format)", isValidAuthorizationId(realShape), true);
eq("url-safe - and _ allowed", isValidAuthorizationId("abcd_efgh-1234"), true);
eq("../../user (path traversal)", isValidAuthorizationId("../../user"), false);
eq("abc12345/consent (slash)", isValidAuthorizationId("abc12345/consent"), false);
eq("abc12345?x=1 (query)", isValidAuthorizationId("abc12345?x=1"), false);
eq("%2e%2e%2fuser (encoded traversal)", isValidAuthorizationId("%2e%2e%2fuser"), false);
eq("abc12345.json (dot)", isValidAuthorizationId("abc12345.json"), false);
eq("7 characters (too short)", isValidAuthorizationId("abc1234"), false);
eq("129 characters (too long)", isValidAuthorizationId("a".repeat(129)), false);
eq("empty string", isValidAuthorizationId(""), false);
eq("undefined", isValidAuthorizationId(undefined), false);
eq("array (repeated query parameter)", isValidAuthorizationId([realShape, realShape]), false);
eq("space inside", isValidAuthorizationId("abc 12345"), false);

console.log("\nconsentPathFor");
eq(
  "builds this page's own path",
  consentPathFor(realShape),
  `/oauth/consent?authorization_id=${realShape}`
);

console.log("\nisSafeRedirectUrl");
eq("Claude's callback with code", isSafeRedirectUrl("https://claude.ai/api/mcp/auth_callback?code=x&state=y"), true);
eq("a localhost test-tool callback", isSafeRedirectUrl("http://localhost:6274/oauth/callback?code=x"), true);
eq("javascript: URL", isSafeRedirectUrl("javascript:alert(1)"), false);
eq("data: URL", isSafeRedirectUrl("data:text/html,<script>alert(1)</script>"), false);
eq("relative path (not a URL)", isSafeRedirectUrl("/dashboard"), false);
eq("empty string", isSafeRedirectUrl(""), false);
eq("undefined", isSafeRedirectUrl(undefined), false);

console.log("\nredirectHostname");
eq("claude.ai callback → claude.ai", redirectHostname("https://claude.ai/api/mcp/auth_callback"), "claude.ai");
eq("garbage → null", redirectHostname("not a url"), null);

console.log("\nclassifyConsentError");
eq("feature_disabled (live answer while the server is off)", classifyConsentError({ status: 404, code: "feature_disabled" }), "disabled");
eq("404 without that code → expired", classifyConsentError({ status: 404, code: "not_found" }), "expired");
eq("410 → expired", classifyConsentError({ status: 410 }), "expired");
eq("400 → unknown", classifyConsentError({ status: 400, code: "validation_failed" }), "unknown");
eq("no status → unknown", classifyConsentError({}), "unknown");

console.log("\nisBackgroundPageFetch");
const h = (obj) => ({ get: (n) => (n in obj ? obj[n] : null) });
eq("Worker fetch: Accept */*, no RSC → background", isBackgroundPageFetch(h({ accept: "*/*" })), true);
eq("no headers at all → background", isBackgroundPageFetch(h({})), true);
eq(
  "browser navigation (Chrome Accept) → page",
  isBackgroundPageFetch(h({ accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8" })),
  false
);
eq(
  "browser navigation (Safari Accept) → page",
  isBackgroundPageFetch(h({ accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" })),
  false
);
eq("Next soft navigation (RSC: 1, Accept */*) → page", isBackgroundPageFetch(h({ rsc: "1", accept: "*/*" })), false);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
