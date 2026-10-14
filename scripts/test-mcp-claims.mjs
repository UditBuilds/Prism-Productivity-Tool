/**
 * Unit checks for lib/mcp/claims.ts — which bearer tokens /api/mcp accepts.
 *
 * The case that matters most: an ordinary BROWSER SESSION token. It carries
 * the same issuer, signing key, `aud` and `role` as an OAuth token from
 * Supabase's OAuth server; the only difference is that it has no
 * `client_id`. It must be refused even when the allowlist is non-empty.
 *
 * Run:  node scripts/test-mcp-claims.mjs
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
const out = mkdtempSync(path.join(tmpdir(), "prism-mcp-claims-"));
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
  const rel = "lib/mcp/claims.ts";
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
      "--lib", "ES2019,DOM",
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
  return import(pathToFileURL(path.join(out, "claims.js")).href);
}

const {
  parseAllowedClientIds,
  readJwtHeader,
  isAcceptedSigningHeader,
  evaluateClaims,
} = await compile();

const ISSUER = "https://nqpdctlqdkvmsaadwahv.supabase.co/auth/v1";
const NOW = 1_800_000_000;
const USER = "399e74e6-1e4c-410a-9129-6cd4857548cd";
const CLAUDE = "11111111-2222-3333-4444-555555555555";
const DEMO_ID = "eac085cc-54df-4414-9c43-08a6ce84ecea";
const policy = (over = {}) => ({
  allowedClientIds: [CLAUDE],
  issuer: ISSUER,
  demoEmail: "demo@prismapp.dev",
  demoUserId: DEMO_ID,
  nowSeconds: NOW,
  ...over,
});

/** Claims shaped exactly like a Supabase PASSWORD SESSION (browser login). */
const browserSession = {
  iss: ISSUER,
  sub: USER,
  aud: "authenticated",
  exp: NOW + 3600,
  iat: NOW,
  email: "someone@example.com",
  phone: "",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  role: "authenticated",
  aal: "aal1",
  amr: [{ method: "password", timestamp: NOW }],
  session_id: "6f2b6c1e-8a3d-4b39-9e9a-2d3c4b5a6f70",
  is_anonymous: false,
};
/** The same, as Supabase's OAuth server issues it to an approved client. */
const oauthToken = { ...browserSession, client_id: CLAUDE };

console.log("\nparseAllowedClientIds");
eq("undefined → []", parseAllowedClientIds(undefined), []);
eq("empty string → []", parseAllowedClientIds(""), []);
eq("only commas/spaces → []", parseAllowedClientIds(" , ,, "), []);
eq("trims and drops blanks", parseAllowedClientIds(` ${CLAUDE} ,, abc `), [CLAUDE, "abc"]);

console.log("\nthe browser-session token (same audience as OAuth tokens)");
eq(
  "REFUSED with a non-empty allowlist — no client_id",
  evaluateClaims(browserSession, policy()),
  { ok: false, reason: "token was not issued to an app" }
);
eq(
  "its aud really is the same as an OAuth token's",
  browserSession.aud === oauthToken.aud && browserSession.role === oauthToken.role,
  true
);

console.log("\nOAuth tokens");
eq("allowed client → accepted", evaluateClaims(oauthToken, policy()), {
  ok: true,
  userId: USER,
  email: "someone@example.com",
  clientId: CLAUDE,
  expiresAt: NOW + 3600,
});
eq(
  "client not on the allowlist → refused",
  evaluateClaims({ ...oauthToken, client_id: "some-other-client" }, policy()).ok,
  false
);
eq(
  "EMPTY allowlist refuses even an otherwise-perfect token",
  evaluateClaims(oauthToken, policy({ allowedClientIds: [] })),
  { ok: false, reason: "no clients are allowed" }
);
eq(
  "empty client_id string → refused",
  evaluateClaims({ ...oauthToken, client_id: "" }, policy()).ok,
  false
);
eq(
  "demo account → refused even from the allowed client",
  evaluateClaims({ ...oauthToken, email: "DEMO@prismapp.dev" }, policy()),
  { ok: false, reason: "the demo account cannot connect apps" }
);
eq(
  "demo account by USER ID even after an email change → refused",
  evaluateClaims({ ...oauthToken, sub: DEMO_ID, email: "renamed@example.com" }, policy()),
  { ok: false, reason: "the demo account cannot connect apps" }
);
eq("anonymous user → refused", evaluateClaims({ ...oauthToken, is_anonymous: true }, policy()).ok, false);
eq("role anon → refused", evaluateClaims({ ...oauthToken, role: "anon" }, policy()).ok, false);
eq("role service_role → refused", evaluateClaims({ ...oauthToken, role: "service_role" }, policy()).ok, false);
eq("other issuer → refused", evaluateClaims({ ...oauthToken, iss: "https://evil.example/auth/v1" }, policy()).ok, false);
eq("wrong audience → refused", evaluateClaims({ ...oauthToken, aud: "something-else" }, policy()).ok, false);
eq("audience as an array containing authenticated → accepted", evaluateClaims({ ...oauthToken, aud: ["authenticated"] }, policy()).ok, true);
eq("sub not a UUID → refused", evaluateClaims({ ...oauthToken, sub: "not-a-uuid" }, policy()).ok, false);
eq("no sub → refused", evaluateClaims({ ...oauthToken, sub: undefined }, policy()).ok, false);
eq("expired (exp == now) → refused", evaluateClaims({ ...oauthToken, exp: NOW }, policy()).ok, false);
eq("no exp → refused", evaluateClaims({ ...oauthToken, exp: undefined }, policy()).ok, false);
eq(
  "no email claim → accepted, email null",
  evaluateClaims({ ...oauthToken, email: undefined }, policy()),
  { ok: true, userId: USER, email: null, clientId: CLAUDE, expiresAt: NOW + 3600 }
);

console.log("\nsigning header (refused before any verification is attempted)");
const b64url = (o) =>
  Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const tokenWith = (header) => `${b64url(header)}.${b64url({})}.sig`;
eq("ES256 + kid → accepted", isAcceptedSigningHeader(readJwtHeader(tokenWith({ alg: "ES256", kid: "a66649c9", typ: "JWT" }))), true);
eq("RS256 + kid → accepted", isAcceptedSigningHeader(readJwtHeader(tokenWith({ alg: "RS256", kid: "k1" }))), true);
eq("HS256 (shared-secret) → refused", isAcceptedSigningHeader(readJwtHeader(tokenWith({ alg: "HS256", kid: "k1" }))), false);
eq("alg none → refused", isAcceptedSigningHeader(readJwtHeader(tokenWith({ alg: "none" }))), false);
eq("ES256 without kid → refused", isAcceptedSigningHeader(readJwtHeader(tokenWith({ alg: "ES256" }))), false);
eq("garbage token → refused", isAcceptedSigningHeader(readJwtHeader("not-a-jwt")), false);
eq("empty token → refused", isAcceptedSigningHeader(readJwtHeader("")), false);

console.log("\nthe demo id the server refuses is the seed's demo account");
const demoTs = readFileSync(path.join(root, "lib/demo.ts"), "utf8");
const seedSql = readFileSync(path.join(root, "supabase/demo-seed.sql"), "utf8");
const demoIdTs = (demoTs.match(/DEMO_USER_ID = "([0-9a-f-]{36})"/) ?? [])[1];
const demoIdSql = (seedSql.match(/demo_id\s+constant uuid := '([0-9a-f-]{36})'/) ?? [])[1];
eq("lib/demo.ts DEMO_USER_ID === supabase/demo-seed.sql demo_id", demoIdTs, demoIdSql);
eq("and it is the id these tests use", demoIdTs, DEMO_ID);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
