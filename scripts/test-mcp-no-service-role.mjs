/**
 * Fails if any MCP code can reach the service-role Supabase client.
 *
 * The MCP server must act AS THE CALLER (anon key + the caller's token, so
 * row-level security applies). The service-role key bypasses RLS entirely;
 * one import of lib/supabase/admin.ts anywhere under the MCP code — even
 * through a helper that imports a helper — would let a tool read or write
 * every user's rows.
 *
 * So this walks imports TRANSITIVELY from every file under the MCP roots,
 * following "@/…" and relative specifiers (packages are not followed), and
 * fails on:
 *  - reaching lib/supabase/admin.ts, or
 *  - any reached file that mentions SUPABASE_SERVICE_ROLE_KEY or
 *    createAdminClient.
 *
 * It first proves it CAN fail: a planted fixture graph with a two-hop import
 * of an admin client must be caught, and a clean one must pass.
 *
 * Run:  node scripts/test-mcp-no-service-role.mjs
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
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

/** The MCP code: every file under these directories is an entry point. */
const MCP_ROOTS = [
  "app/api/mcp",
  "app/.well-known/oauth-protected-resource",
  "lib/mcp",
];
const ADMIN_FILE = "lib/supabase/admin.ts";
const FORBIDDEN_TEXT = /SUPABASE_SERVICE_ROLE_KEY|createAdminClient/;
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];

function listSourceFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

function specifiers(source) {
  const found = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?[^'"]*?\bfrom\s*["']([^"']+)["']/g,
    /\bexport\s+[^'"]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) found.push(m[1]);
  return found;
}

function resolve(spec, fromFile, base) {
  let target;
  if (spec.startsWith("@/")) target = path.join(base, spec.slice(2));
  else if (spec.startsWith(".")) target = path.resolve(path.dirname(fromFile), spec);
  else return null; // a package — not followed
  for (const ext of EXTENSIONS) {
    const candidate = target + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Walk imports from `entries`; return violations with the chain that reached them. */
function scan(base, entries) {
  const admin = path.join(base, ADMIN_FILE);
  const parent = new Map(entries.map((e) => [e, null]));
  const queue = [...entries];
  const violations = [];
  const chain = (file) => {
    const steps = [];
    for (let f = file; f; f = parent.get(f)) {
      steps.unshift(path.relative(base, f).split(path.sep).join("/"));
    }
    return steps.join("  ->  ");
  };
  while (queue.length) {
    const file = queue.shift();
    if (path.resolve(file) === path.resolve(admin)) {
      violations.push(`imports the service-role client: ${chain(file)}`);
      continue;
    }
    const text = readFileSync(file, "utf8");
    if (FORBIDDEN_TEXT.test(text)) {
      violations.push(`mentions the service-role key/client: ${chain(file)}`);
    }
    for (const spec of specifiers(text)) {
      const next = resolve(spec, file, base);
      if (next && !parent.has(next)) {
        parent.set(next, file);
        queue.push(next);
      }
    }
  }
  return { violations, visited: parent.size };
}

// ── 1. prove the scanner can fail ─────────────────────────────────────
console.log("\nself-test: a planted two-hop import must be caught");
const fx = mkdtempSync(path.join(tmpdir(), "prism-no-service-role-"));
const write = (rel, text) => {
  mkdirSync(path.dirname(path.join(fx, rel)), { recursive: true });
  writeFileSync(path.join(fx, rel), text);
};
write(ADMIN_FILE, "export const createAdminClient = () => process.env.SUPABASE_SERVICE_ROLE_KEY;\n");
write("lib/helper.ts", 'import { createAdminClient } from "@/lib/supabase/admin";\nexport const x = createAdminClient;\n');
write("lib/mcp/bad.ts", 'import { x } from "../helper";\nexport const y = x;\n');
write("lib/mcp/good.ts", 'import { createClient } from "@supabase/supabase-js";\nexport const z = createClient;\n');
const planted = scan(fx, [path.join(fx, "lib/mcp/bad.ts")]);
eq("planted graph → violation found", planted.violations.length > 0, true);
eq(
  "the reported chain names the hops",
  planted.violations[0]?.includes("lib/mcp/bad.ts") && planted.violations[0]?.includes("lib/helper.ts"),
  true
);
eq("clean fixture → no violation", scan(fx, [path.join(fx, "lib/mcp/good.ts")]).violations, []);

// ── 2. the real MCP code ──────────────────────────────────────────────
console.log("\nreal MCP code");
const entries = MCP_ROOTS.flatMap((dir) => listSourceFiles(path.join(root, dir)));
eq("found MCP entry files to check", entries.length > 0, true);
const real = scan(root, entries);
console.log(`        (${entries.length} entry files, ${real.visited} files reached)`);
for (const v of real.violations) console.log("        " + v);
eq("no MCP file can reach the service-role client", real.violations, []);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
