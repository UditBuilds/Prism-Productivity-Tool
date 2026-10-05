/**
 * Unit checks for lib/supabase/select-all.ts — the pager that replaces reads
 * PostgREST was silently cutting at 1,000 rows.
 *
 * The query builder is a FAKE that models the two server behaviours the helper
 * depends on: every response is capped at 1,000 rows no matter what was asked
 * for, and rows that tie on every sort key come back in insertion order (what
 * Postgres usually does for fresh rows, and what the app showed before). The
 * cap itself was measured against the live project, not assumed: no range,
 * `limit=1000` and `limit=5000` all answered `Content-Range: 0-999/*`.
 *
 * Run:  node scripts/test-select-all.mjs
 *
 * Compiles with the project's own `typescript` devDependency — no test runner,
 * matching the other scripts/test-*.mjs.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const out = mkdtempSync(path.join(tmpdir(), "prism-select-all-"));
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

function ok(label, cond) {
  eq(label, !!cond, true);
}

function compile() {
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules", "typescript", "bin", "tsc"),
      "--target", "ES2019",
      "--module", "ES2020",
      "--moduleResolution", "node",
      "--skipLibCheck",
      "--outDir", out,
      path.join(root, "lib", "supabase", "select-all.ts"),
    ],
    { stdio: "inherit" }
  );
  writeFileSync(path.join(out, "package.json"), JSON.stringify({ type: "module" }));
  return import(pathToFileURL(path.join(out, "select-all.js")).href);
}

const { selectAllRows, POSTGREST_MAX_ROWS } = await compile();

// ── fake PostgREST ────────────────────────────────────────────────────────
const SERVER_CAP = 1000;

/**
 * A server holding `table` (insertion order = physical order). `failAt` makes
 * the Nth request (0-based) return an error.
 */
function fakeServer(table, { failAt = -1 } = {}) {
  const requests = [];

  function build() {
    const orders = [];
    let range = null;
    const builder = {
      order(column, options = {}) {
        orders.push({ column, ascending: options.ascending !== false });
        return builder;
      },
      range(from, to) {
        range = [from, to];
        return builder;
      },
      then(resolve, reject) {
        const n = requests.length;
        requests.push({ orders: orders.map((o) => o.column), range });
        if (n === failAt) {
          return Promise.resolve({
            data: null,
            error: { message: "boom on request " + n },
          }).then(resolve, reject);
        }
        // Stable sort: rows tied on every key keep insertion order.
        const sorted = table
          .map((row, i) => ({ row, i }))
          .sort((a, b) => {
            for (const { column, ascending } of orders) {
              const x = a.row[column];
              const y = b.row[column];
              if (x === y) continue;
              const cmp = x < y ? -1 : 1;
              return ascending ? cmp : -cmp;
            }
            return a.i - b.i;
          })
          .map((e) => e.row);
        const [from, to] = range ?? [0, Infinity];
        const limit = Math.min(to - from + 1, SERVER_CAP);
        const data = sorted.slice(from, from + limit);
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  return { build, requests };
}

/** n rows whose sort key `k` has only `distinct` values, so most rows tie. */
function rows(n, distinct = n) {
  return Array.from({ length: n }, (_, i) => ({
    // ids deliberately NOT in insertion order, so a tiebreaker visibly reorders
    id: "id-" + String((i * 7919) % 100003).padStart(6, "0"),
    k: i % distinct,
    seq: i,
  }));
}

const asWritten = (server) => () => server.build().order("k", { ascending: true });

// ── sanity: the fake really caps ──────────────────────────────────────────
console.log("\nfake server");
{
  const server = fakeServer(rows(2500));
  const res = await server.build().order("k");
  eq("an unpaged read of 2,500 rows returns 1,000", res.data.length, 1000);
  eq("helper page size matches the measured cap", POSTGREST_MAX_ROWS, SERVER_CAP);
}

// ── fast path: identical to the unpaged read ──────────────────────────────
console.log("\nunder one page — one request, rows exactly as before");
for (const n of [0, 1, 37, 999]) {
  const table = rows(n, 5); // heavy ties
  const before = await fakeServer(table).build().order("k", { ascending: true });
  const server = fakeServer(table);
  const res = await selectAllRows(asWritten(server));
  eq(`${n} rows: no error`, res.error, null);
  eq(`${n} rows: same rows, same order, ties included`, res.data.map((r) => r.seq), before.data.map((r) => r.seq));
  eq(`${n} rows: exactly one request`, server.requests.length, 1);
  eq(`${n} rows: no tiebreaker added`, server.requests[0].orders, ["k"]);
  eq(`${n} rows: asked for one page`, server.requests[0].range, [0, 999]);
}

// ── paging ────────────────────────────────────────────────────────────────
console.log("\nfull first page — restart with a total order and page");
for (const n of [1000, 1001, 2500, 4321]) {
  const table = rows(n, 3); // almost everything ties on k
  const server = fakeServer(table);
  const res = await selectAllRows(asWritten(server));
  eq(`${n} rows: no error`, res.error, null);
  eq(`${n} rows: every row returned`, res.data.length, n);
  eq(`${n} rows: no duplicates`, new Set(res.data.map((r) => r.id)).size, n);
  const expected = [...table]
    .sort((a, b) => a.k - b.k || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => r.id);
  eq(`${n} rows: ordered by the query's keys, then id`, res.data.map((r) => r.id), expected);
  ok(
    `${n} rows: every paged request ends in the id tiebreaker`,
    server.requests.slice(1).every((r) => r.orders.join(",") === "k,id")
  );
  const pages = Math.floor(n / 1000) + 1;
  eq(`${n} rows: 1 probe + ${pages} pages`, server.requests.length, 1 + pages);
}

// ── maxRows ───────────────────────────────────────────────────────────────
console.log("\nmaxRows — what .limit(n) was meant to do");
{
  const table = rows(7300, 50);
  const server = fakeServer(table);
  const res = await selectAllRows(asWritten(server), { maxRows: 5000 });
  eq("7,300 rows, maxRows 5,000: returns 5,000", res.data.length, 5000);
  eq(
    "requests: probe, then five pages ending at 4,999",
    server.requests.map((r) => r.range),
    [[0, 999], [0, 999], [1000, 1999], [2000, 2999], [3000, 3999], [4000, 4999]]
  );
  const expected = [...table]
    .sort((a, b) => a.k - b.k || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 5000)
    .map((r) => r.id);
  eq("the FIRST 5,000 in query order, as .limit would give", res.data.map((r) => r.id), expected);
}
{
  const server = fakeServer(rows(7300));
  const res = await selectAllRows(asWritten(server), { maxRows: 300 });
  eq("maxRows under a page: 300 rows", res.data.length, 300);
  eq("maxRows under a page: one request for exactly 300", server.requests.map((r) => r.range), [[0, 299]]);
}
{
  const server = fakeServer(rows(2500));
  const res = await selectAllRows(asWritten(server), { maxRows: 1000 });
  eq("maxRows equal to a page: 1,000 rows, one request", [res.data.length, server.requests.length], [1000, 1]);
}
{
  const server = fakeServer(rows(1500));
  const res = await selectAllRows(asWritten(server), { maxRows: 1200 });
  eq("maxRows 1,200 over 1,500 rows: 1,200 rows", res.data.length, 1200);
  eq("last page asks for only the remainder", server.requests.at(-1).range, [1000, 1199]);
}

// ── tiebreaker option ─────────────────────────────────────────────────────
console.log("\ntiebreaker");
{
  const server = fakeServer(rows(1500, 2));
  await selectAllRows(asWritten(server), { tiebreaker: "seq" });
  ok("custom tiebreaker is the last sort key", server.requests.slice(1).every((r) => r.orders.join(",") === "k,seq"));
}

// ── errors ────────────────────────────────────────────────────────────────
console.log("\nerrors");
{
  const res = await selectAllRows(asWritten(fakeServer(rows(10), { failAt: 0 })));
  eq("error on the first request → data null", res.data, null);
  eq("…and the error is passed through", res.error, { message: "boom on request 0" });
}
{
  const res = await selectAllRows(asWritten(fakeServer(rows(3500), { failAt: 3 })));
  eq("error on a later page → data null, no partial rows", res.data, null);
  eq("…with that page's error", res.error, { message: "boom on request 3" });
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
