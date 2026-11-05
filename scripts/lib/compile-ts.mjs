/**
 * Load app TypeScript modules into a plain Node test, with no test runner.
 *
 * Starting from the entry files, each module is transpiled with the
 * project's own `typescript` (transpileModule: syntax only — `tsc --noEmit`
 * in CI is what checks the types), its `@/…` and relative imports are
 * rewritten to the emitted `.js` files, and every import it still has at
 * runtime is followed. Type-only imports vanish in transpilation, so a module
 * that only NAMES Supabase or Next types never loads them.
 *
 * `stubs` replaces a specifier (e.g. "@/lib/supabase/server") with a small
 * JS module source, for the few runtime imports a test must not execute.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const IMPORT_RE =
  /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"']+)\2/g;

function resolveSource(root, fromFile, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(root, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // a package or node: builtin — left as it is
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), base]) {
    if (existsSync(candidate) && candidate.match(/\.(ts|tsx|js|mjs)$/)) return candidate;
  }
  throw new Error(`compile-ts: cannot resolve "${spec}" from ${fromFile}`);
}

export function compileTs(entries, { root = process.cwd(), stubs = {}, label = "ts" } = {}) {
  const outDir = mkdtempSync(path.join(tmpdir(), `prism-${label}-`));
  writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));

  const outPathFor = (src) =>
    path.join(outDir, path.relative(root, src)).replace(/\.(ts|tsx)$/, ".js");
  const stubPathFor = (spec) =>
    path.join(outDir, "__stubs__", spec.replace(/[^a-zA-Z0-9]+/g, "_") + ".js");

  const done = new Set();
  const queue = entries.map((e) => path.join(root, e));

  for (const [spec, source] of Object.entries(stubs)) {
    const p = stubPathFor(spec);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, source);
  }

  while (queue.length > 0) {
    const src = queue.shift();
    if (done.has(src)) continue;
    done.add(src);

    const js = ts.transpileModule(readFileSync(src, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: src,
    }).outputText;

    const outFile = outPathFor(src);
    const rewritten = js.replace(IMPORT_RE, (whole, lead, quote, spec) => {
      let target;
      if (stubs[spec] !== undefined) target = stubPathFor(spec);
      else {
        const resolved = resolveSource(root, src, spec);
        if (!resolved) return whole;
        queue.push(resolved);
        target = outPathFor(resolved);
      }
      let rel = path.relative(path.dirname(outFile), target).split(path.sep).join("/");
      if (!rel.startsWith(".")) rel = `./${rel}`;
      return `${lead}${quote}${rel}${quote}`;
    });

    mkdirSync(path.dirname(outFile), { recursive: true });
    writeFileSync(outFile, rewritten);
  }

  return {
    outDir,
    /** import() an entry by its repo-relative source path. */
    load: (rel) => import(pathToFileURL(outPathFor(path.join(root, rel))).href),
  };
}
