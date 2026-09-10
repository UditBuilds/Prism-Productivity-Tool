/**
 * Unit checks for the Instagram publishing module (lib/instagram/*).
 *
 * Everything asserted here is the part of the module that runs BEFORE any
 * network call: config reading, media-URL and caption validation, Meta's error
 * envelope mapping, secret redaction, and token-expiry arithmetic. That split
 * is deliberate — those are the pieces that decide whether a failure is
 * reported honestly, and they are the pieces that can be exercised without
 * credentials.
 *
 * What this does NOT cover: an actual publish. The two-step flow needs the four
 * Meta env vars and a live account; with none available, a mocked "publish"
 * would assert only that the mock was written to match the code. The live
 * result belongs in the PR description, not in a green test.
 *
 * Run:  node scripts/test-instagram-publish.mjs
 *
 * Compiles with the project's own `typescript` devDependency — no test runner,
 * matching scripts/test-workout-analysis.mjs.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const out = mkdtempSync(path.join(tmpdir(), "prism-instagram-"));
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

/** Assert that fn() throws an InstagramError carrying `code`. */
function throwsCode(label, fn, code) {
  checks++;
  try {
    fn();
    failures++;
    console.log("  FAIL  " + label + "\n        expected throw " + code + ", got none");
  } catch (e) {
    if (e && e.code === code) {
      console.log("  ok    " + label);
    } else {
      failures++;
      console.log(
        "  FAIL  " + label + "\n        expected code " + code + "\n        actual   " + (e && e.code)
      );
    }
  }
}

function compile() {
  // config/errors/types/client/token import each other with relative
  // specifiers only, so they need no alias rewriting. media-url.ts is the one
  // exception: it imports "@/lib/supabase/admin". It is rewritten to a local
  // stub that THROWS if called, which both makes the module importable here
  // and proves the assertion below — publicMediaUrl builds its URL by string,
  // and never reaches for a storage client.
  const srcs = [
    "lib/instagram/types.ts",
    "lib/instagram/errors.ts",
    "lib/instagram/config.ts",
    "lib/instagram/client.ts",
    "lib/instagram/token.ts",
    "lib/instagram/media-url.ts",
  ];
  for (const rel of srcs) {
    const text = readFileSync(path.join(root, rel), "utf8")
      .replace(/["']@\/lib\/supabase\/admin["']/g, '"./admin.js"')
      // tsc preserves relative specifiers verbatim, and Node's ESM loader
      // requires the extension. The alias above is already ".js", and the
      // character class excludes ".", so it is not rewritten twice.
      .replace(/(from\s+["'])\.\/([A-Za-z0-9_-]+)(["'])/g, "$1./$2.js$3");
    writeFileSync(path.join(out, path.basename(rel)), text);
  }
  // Typed structurally to match only what media-url.ts actually uses, so the
  // stub still typechecks the call sites rather than erasing them to `any`.
  writeFileSync(
    path.join(out, "admin.ts"),
    [
      "type Res<T> = Promise<{ data: T | null; error: { message: string } | null }>;",
      "interface StubStorage {",
      "  from(bucket: string): {",
      "    createSignedUrl(path: string, expiresIn: number): Res<{ signedUrl: string }>;",
      "    upload(path: string, bytes: unknown, opts: unknown): Res<unknown>;",
      "  };",
      "}",
      "export function createAdminClient(): { storage: StubStorage } {",
      "  throw new Error('storage client must not be constructed in unit tests');",
      "}",
      "",
    ].join("\n")
  );

  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules", "typescript", "bin", "tsc"),
      "--target", "ES2020",
      "--module", "ES2020",
      "--moduleResolution", "node",
      "--strict",
      "--skipLibCheck",
      "--outDir", out,
      path.join(out, "admin.ts"),
      ...srcs.map((s) => path.join(out, path.basename(s))),
    ],
    { stdio: "inherit" }
  );
  writeFileSync(
    path.join(out, "package.json"),
    JSON.stringify({ type: "module" })
  );
}

compile();

const load = (name) => import(pathToFileURL(path.join(out, name)).href);

const { readInstagramConfig, DEFAULT_GRAPH_VERSION } = await load("config.js");
const { assertFetchableMediaUrl, assertValidCaption } = await load("client.js");
const { instagramErrorFromGraph, redactSecrets } = await load("errors.js");
const { needsRenewal, describeTokenHealth } = await load("token.js");
const { publicMediaUrl } = await load("media-url.js");
const { IG_CAPTION_MAX_CHARS } = await load("types.js");

const ENV_KEYS = [
  "META_APP_ID",
  "META_APP_SECRET",
  "IG_BUSINESS_ACCOUNT_ID",
  "META_PAGE_ACCESS_TOKEN",
  "META_GRAPH_API_VERSION",
];

/** Run fn with exactly the given Meta vars set, restoring the environment after. */
function withEnv(vars, fn) {
  const saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    for (const [k, v] of Object.entries(vars)) process.env[k] = v;
    return fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const ALL = {
  META_APP_ID: "123456789",
  META_APP_SECRET: "s3cret",
  IG_BUSINESS_ACCOUNT_ID: "17841400000000000",
  META_PAGE_ACCESS_TOKEN: "EAAtesttoken0000000",
};

console.log("\nconfig — which credentials are missing");
eq(
  "all four absent are all four reported, in declaration order",
  withEnv({}, () => readInstagramConfig().missing),
  ["META_APP_ID", "META_APP_SECRET", "IG_BUSINESS_ACCOUNT_ID", "META_PAGE_ACCESS_TOKEN"]
);
eq(
  "a partial set reports only what is missing",
  withEnv({ META_APP_ID: "1", META_APP_SECRET: "2" }, () => readInstagramConfig().missing),
  ["IG_BUSINESS_ACCOUNT_ID", "META_PAGE_ACCESS_TOKEN"]
);
eq(
  "no config object is returned while anything is missing",
  withEnv({ META_APP_ID: "1" }, () => readInstagramConfig().config),
  null
);
// The reason empty-string is treated as missing: `META_APP_SECRET=` in a .env
// file is defined-but-empty, which passes an `!== undefined` check and then
// fails downstream as an opaque Meta auth error instead of a named gap.
eq(
  "an empty value counts as missing, not as set",
  withEnv({ ...ALL, META_APP_SECRET: "   " }, () => readInstagramConfig().missing),
  ["META_APP_SECRET"]
);
eq(
  "a complete set reports nothing missing",
  withEnv(ALL, () => readInstagramConfig().missing),
  []
);
eq(
  "graph version defaults when unset",
  withEnv(ALL, () => readInstagramConfig().config.graphVersion),
  DEFAULT_GRAPH_VERSION
);
eq(
  "graph version is overridable",
  withEnv({ ...ALL, META_GRAPH_API_VERSION: "v25.0" }, () =>
    readInstagramConfig().config.graphVersion
  ),
  "v25.0"
);

console.log("\nmedia URL — reachability from Meta's fetcher, not from here");
eq(
  "a public https URL passes",
  assertFetchableMediaUrl("https://example.supabase.co/storage/v1/object/public/x/a.jpg"),
  undefined
);
throwsCode("http is rejected", () => assertFetchableMediaUrl("http://example.com/a.jpg"), "INVALID_MEDIA_URL");
throwsCode("a non-URL is rejected", () => assertFetchableMediaUrl("not a url"), "INVALID_MEDIA_URL");
// The realistic mistake: pointing Meta at a dev server.
throwsCode("localhost is rejected", () => assertFetchableMediaUrl("https://localhost:3000/a.jpg"), "INVALID_MEDIA_URL");
throwsCode("127.0.0.1 is rejected", () => assertFetchableMediaUrl("https://127.0.0.1/a.jpg"), "INVALID_MEDIA_URL");
throwsCode("a 192.168 address is rejected", () => assertFetchableMediaUrl("https://192.168.1.20/a.jpg"), "INVALID_MEDIA_URL");
throwsCode("a 172.16 address is rejected", () => assertFetchableMediaUrl("https://172.16.0.5/a.jpg"), "INVALID_MEDIA_URL");
eq(
  "172.32 is public and passes (the private range ends at 172.31)",
  assertFetchableMediaUrl("https://172.32.0.5/a.jpg"),
  undefined
);

console.log("\ncaption guard");
eq("a caption at the limit passes", assertValidCaption("x".repeat(IG_CAPTION_MAX_CHARS)), undefined);
throwsCode(
  "one character over the limit is rejected",
  () => assertValidCaption("x".repeat(IG_CAPTION_MAX_CHARS + 1)),
  "CAPTION_TOO_LONG"
);

console.log("\nGraph error mapping — the envelope's code, not the HTTP status");
const graph = (code, message) => ({ error: { message, code, fbtrace_id: "Atrace" } });
eq("190 is a token problem", instagramErrorFromGraph(400, graph(190, "Session expired")).code, "TOKEN_INVALID");
eq("102 is a token problem", instagramErrorFromGraph(400, graph(102, "Session invalid")).code, "TOKEN_INVALID");
eq("4 is throttling", instagramErrorFromGraph(400, graph(4, "Too many calls")).code, "RATE_LIMITED");
eq("17 is throttling", instagramErrorFromGraph(400, graph(17, "User request limit")).code, "RATE_LIMITED");
eq("32 is throttling", instagramErrorFromGraph(400, graph(32, "Page request limit")).code, "RATE_LIMITED");
eq("613 is throttling", instagramErrorFromGraph(400, graph(613, "Calls to this api have exceeded the rate limit")).code, "RATE_LIMITED");
eq("10 is a permission problem", instagramErrorFromGraph(403, graph(10, "Permission denied")).code, "PERMISSION_DENIED");
eq("200 is a permission problem", instagramErrorFromGraph(403, graph(200, "Requires permission")).code, "PERMISSION_DENIED");
eq("an unmapped code stays GRAPH_ERROR", instagramErrorFromGraph(400, graph(100, "Invalid parameter")).code, "GRAPH_ERROR");
// Three different failures all arrive as 400 from Meta, which is exactly why
// the status must not drive the category.
eq("a 400 token error is not miscategorised by its status", instagramErrorFromGraph(400, graph(190, "x")).code, "TOKEN_INVALID");
eq("429 is throttling regardless of the envelope", instagramErrorFromGraph(429, graph(100, "x")).code, "RATE_LIMITED");
eq(
  "Meta's own message is surfaced, not replaced",
  instagramErrorFromGraph(400, graph(100, "Invalid parameter")).message,
  "Invalid parameter"
);
eq("fbtrace_id is kept for a Meta bug report", instagramErrorFromGraph(400, graph(100, "x")).fbtraceId, "Atrace");
eq(
  "a body with no envelope still yields a usable message",
  instagramErrorFromGraph(500, null).message,
  "Instagram API error (HTTP 500)"
);
eq("every mapped error carries a hint", instagramErrorFromGraph(400, graph(190, "x")).hint.length > 0, true);

console.log("\nredaction — a token in an error is a credential in a log");
eq(
  "a long-lived token is redacted",
  redactSecrets("failed for EAABsbCS1iHgBA0characters00000here"),
  "failed for [redacted-token]"
);
eq(
  "an app access token is redacted",
  redactSecrets("used 123456789|abcdefghij0123456789"),
  "used [redacted-app-token]"
);
eq(
  "an access_token query param is redacted",
  redactSecrets("GET /me?access_token=abc123&fields=id"),
  "GET /me?access_token=[redacted]&fields=id"
);
eq("ordinary text is untouched", redactSecrets("Invalid parameter"), "Invalid parameter");

console.log("\ntoken expiry — the expires_at:0 trap");
const health = (over) => ({
  isValid: true,
  expiresAt: null,
  daysRemaining: null,
  dataAccessExpiresAt: null,
  scopes: [],
  profileId: null,
  appId: "1",
  ...over,
});
// Meta encodes "never expires" as expires_at: 0. Read through new Date(0) it
// looks maximally expired, and a naive "renew if expiring soon" check would
// then fire forever on the one token that needs nothing.
eq("a non-expiring token never needs renewal", needsRenewal(health()), false);
eq("an invalid token always needs renewal", needsRenewal(health({ isValid: false })), true);
eq("a token 3 days out needs renewal", needsRenewal(health({ daysRemaining: 3 })), true);
eq("a token 30 days out does not", needsRenewal(health({ daysRemaining: 30 })), false);
eq("the threshold day itself needs renewal", needsRenewal(health({ daysRemaining: 7 })), true);
eq(
  "a Page token is described as non-expiring, not as expired",
  describeTokenHealth(health({ profileId: "999" })),
  "Token is valid and does not expire (long-lived Page token)."
);
eq(
  "an invalid token says so first",
  describeTokenHealth(health({ isValid: false, daysRemaining: 40 })),
  "Token is not valid — it was revoked, expired, or belongs to another app."
);
eq("day counts are singular where they should be", describeTokenHealth(health({ daysRemaining: 1 })), "Token is valid for 1 more day.");

console.log("\npublic media URL shape");
// Measured against the live project: /object/public/<bucket>/<path> is the
// route that serves a public bucket. On a PRIVATE bucket the same route
// answers 400 NoSuchBucket, which is why the bucket must be created public.
const withUrl = (fn) => {
  const saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = saved;
  }
};
eq(
  "builds the documented public object route",
  withUrl(() => publicMediaUrl("demo/a.jpg")),
  "https://proj.supabase.co/storage/v1/object/public/instagram-media/demo/a.jpg"
);
eq(
  "a leading slash does not produce a double slash",
  withUrl(() => publicMediaUrl("/demo/a.jpg")),
  "https://proj.supabase.co/storage/v1/object/public/instagram-media/demo/a.jpg"
);
throwsCode(
  "no Supabase URL configured is reported, not guessed around",
  () => {
    const saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      publicMediaUrl("a.jpg");
    } finally {
      if (saved !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = saved;
    }
  },
  "NOT_CONFIGURED"
);

console.log(
  "\n" + (failures === 0 ? "PASS" : "FAIL") + " — " + checks + " checks, " + failures + " failed\n"
);
process.exit(failures === 0 ? 0 : 1);
