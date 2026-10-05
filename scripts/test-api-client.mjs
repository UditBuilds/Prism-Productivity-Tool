/**
 * Equivalence checks for lib/api/client.ts (apiFetch) against the two request
 * helpers it replaced, which were copied verbatim into every hook file.
 *
 * The bar is IDENTICAL behaviour, not "close": every offline-resumable
 * mutationFn now runs through apiFetch, and TanStack's retry/pause logic only
 * ever sees what it sends and what it throws. So each case runs the OLD code
 * (pasted below, unchanged) and the NEW helper against the same mocked fetch
 * and compares the request that went out, the value that came back, and the
 * error message that was thrown.
 *
 * Run:  node scripts/test-api-client.mjs
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
const out = mkdtempSync(path.join(tmpdir(), "prism-api-client-"));
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
  for (const rel of ["lib/api/client.ts", "lib/api/envelope.ts"]) {
    const text = readFileSync(path.join(root, rel), "utf8").replace(
      /["']@\/lib\/api\/envelope["']/g,
      '"./envelope.js"'
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
      path.join(out, "client.ts"),
      path.join(out, "envelope.ts"),
    ],
    { stdio: "inherit" }
  );
  writeFileSync(path.join(out, "package.json"), JSON.stringify({ type: "module" }));
  return import(pathToFileURL(path.join(out, "client.js")).href);
}

const { apiFetch } = await compile();

// ── the OLD code, verbatim from hooks/useNotes.ts and hooks/useCalendar.ts ──
// (types stripped; logic untouched)
async function oldRequest(method, body) {
  const res = await fetch("/api/notes", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok || json.error || json.data === null) {
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  return json.data;
}

async function oldGet(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || json.error || json.data === null) {
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  return json.data;
}

// ── mocked fetch ──────────────────────────────────────────────────────────
let calls = [];
function respond(status, text) {
  globalThis.fetch = async (...args) => {
    calls.push({ argCount: args.length, url: args[0], init: args[1] });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => JSON.parse(text),
    };
  };
}

async function outcome(fn) {
  calls = [];
  try {
    const value = await fn();
    return { value, calls: snapshot() };
  } catch (err) {
    return { threw: err instanceof Error ? `${err.name}: ${err.message}` : String(err), calls: snapshot() };
  }
}

// `init` is compared by its OWN keys and values, including keys explicitly set
// to undefined — those are what the old code passed, so they must match too.
function snapshot() {
  return calls.map((c) => ({
    argCount: c.argCount,
    url: c.url,
    initIsUndefined: c.init === undefined,
    initKeys: c.init === undefined ? null : Object.keys(c.init),
    method: c.init?.method,
    headers: c.init?.headers ?? "(none)",
    body: c.init?.body ?? "(none)",
  }));
}

const RESPONSES = [
  ["200 with data", 200, JSON.stringify({ data: [{ id: "a" }], error: null })],
  ["200 with data 0", 200, JSON.stringify({ data: 0, error: null })],
  ["200 with data false", 200, JSON.stringify({ data: false, error: null })],
  ["200 with error string", 200, JSON.stringify({ data: null, error: "Title is required" })],
  ["200 with data AND error", 200, JSON.stringify({ data: { id: "a" }, error: "odd" })],
  ["200 with data null, no error", 200, JSON.stringify({ data: null, error: null })],
  ["201 created", 201, JSON.stringify({ data: { id: "n" }, error: null })],
  ["400 with error", 400, JSON.stringify({ data: null, error: "Invalid JSON body" })],
  ["401 unauthorized", 401, JSON.stringify({ data: null, error: "Unauthorized" })],
  ["429 with error", 429, JSON.stringify({ data: null, error: "Too many AI requests" })],
  ["500 with no error field", 500, JSON.stringify({})],
  ["500 with data but not ok", 500, JSON.stringify({ data: [1], error: null })],
  ["504 HTML page (not JSON)", 504, "<!DOCTYPE html><html>An error occurred</html>"],
  ["200 empty body (not JSON)", 200, ""],
];

console.log("\nmethod + body (the mutation / CRUD helpers)");
const BODIES = [
  ["object body", { id: "x", title: "t" }],
  ["no body", undefined],
  ["null body", null],
  ["string id body", "abc"],
  ["empty-string body (falsy)", ""],
  ["zero body (falsy)", 0],
];
for (const [method] of [["GET"], ["POST"], ["PATCH"], ["DELETE"]]) {
  for (const [bodyLabel, body] of BODIES) {
    for (const [respLabel, status, text] of RESPONSES) {
      respond(status, text);
      const before = await outcome(() => oldRequest(method, body));
      respond(status, text);
      const after = await outcome(() => apiFetch("/api/notes", method, body));
      eq(`${method} · ${bodyLabel} · ${respLabel}`, after, before);
    }
  }
}

console.log("\nGET with no init (the read-only hooks)");
for (const [respLabel, status, text] of RESPONSES) {
  respond(status, text);
  const before = await outcome(() => oldGet("/api/calendar?month=2026-10"));
  respond(status, text);
  const after = await outcome(() => apiFetch("/api/calendar?month=2026-10"));
  eq(`no-init GET · ${respLabel}`, after, before);
}

console.log("\nspot checks on what the shared helper actually does");
respond(200, JSON.stringify({ data: null, error: null }));
eq("null data → the old fallback message", (await outcome(() => apiFetch("/x"))).threw, "Error: Request failed (200)");
respond(504, "<html>");
eq("non-JSON body → still the raw SyntaxError, unchanged", (await outcome(() => apiFetch("/x"))).threw.startsWith("SyntaxError"), true);
respond(200, JSON.stringify({ data: 1, error: null }));
await outcome(() => apiFetch("/x"));
eq("no method → fetch called with ONE argument's worth (init undefined)", snapshot()[0].initIsUndefined, true);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
