/**
 * Unit checks for lib/color-mode.ts — the light/dark rules shared by the
 * pre-paint script in app/layout.tsx and ThemeProvider.
 *
 * The script is the part that decides the FIRST frame, so it is run for real:
 * the exact string colorModeScript() returns, wrapped in the same try/catch
 * app/layout.tsx wraps it in, inside a vm sandbox with a fake <html>, meta,
 * localStorage and matchMedia. The server always renders `dark`; the script
 * may only ever take it away, and only when the stored choice resolves to
 * light.
 *
 * Run:  node scripts/test-color-mode.mjs
 *
 * Compiles with the project's own `typescript` devDependency — no test runner,
 * matching scripts/test-learning-streak.mjs.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const root = process.cwd();
const out = mkdtempSync(path.join(tmpdir(), "prism-color-mode-"));
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
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules", "typescript", "bin", "tsc"),
      "--target", "ES2019",
      "--module", "ES2020",
      "--moduleResolution", "node",
      "--skipLibCheck",
      "--outDir", out,
      path.join(root, "lib", "color-mode.ts"),
    ],
    { stdio: "inherit" }
  );
  writeFileSync(path.join(out, "package.json"), JSON.stringify({ type: "module" }));
  return import(pathToFileURL(path.join(out, "color-mode.js")).href);
}

const {
  COLOR_MODE_KEY,
  DEFAULT_COLOR_MODE,
  THEME_COLOR,
  colorModeScript,
  parseColorMode,
  resolveColorMode,
} = await compile();

console.log("\nconstants");
eq("default mode is dark", DEFAULT_COLOR_MODE, "dark");
eq("storage key", COLOR_MODE_KEY, "prism-color-mode");
eq("theme-color per painted mode", THEME_COLOR, { light: "#FFFFFF", dark: "#0F1012" });

console.log("\nparseColorMode");
eq("nothing stored → default (dark)", parseColorMode(null), "dark");
eq("empty string → default", parseColorMode(""), "dark");
eq("unknown value → default", parseColorMode("sepia"), "dark");
eq("case matters: LIGHT is not light", parseColorMode("LIGHT"), "dark");
eq("light", parseColorMode("light"), "light");
eq("dark", parseColorMode("dark"), "dark");
eq("system", parseColorMode("system"), "system");

console.log("\nresolveColorMode");
eq("light stays light on a dark OS", resolveColorMode("light", false), "light");
eq("dark stays dark on a light OS", resolveColorMode("dark", true), "dark");
eq("system on a light OS → light", resolveColorMode("system", true), "light");
eq("system on a dark OS → dark", resolveColorMode("system", false), "dark");

/**
 * Run the pre-paint script against a page the server rendered dark.
 * `stored` undefined = nothing in storage; "THROW" = storage access throws.
 */
function firstFrame({ stored, osLight, noMatchMedia = false }) {
  const classes = new Set(["dark", "__font_sans"]);
  let classWrites = 0;
  const meta = {
    content: THEME_COLOR.dark,
    getAttribute: (n) => (n === "content" ? meta.content : null),
    setAttribute: (n, v) => {
      if (n === "content") meta.content = v;
    },
  };
  const sandbox = {
    document: {
      documentElement: {
        classList: {
          remove: (c) => {
            classWrites++;
            classes.delete(c);
          },
          add: (c) => {
            classWrites++;
            classes.add(c);
          },
          contains: (c) => classes.has(c),
        },
      },
      querySelector: (sel) => (sel === 'meta[name="theme-color"]' ? meta : null),
    },
    localStorage: {
      getItem: (k) => {
        if (stored === "THROW") throw new Error("SecurityError");
        return k === COLOR_MODE_KEY && stored !== undefined ? stored : null;
      },
    },
  };
  if (!noMatchMedia) {
    sandbox.matchMedia = (q) => ({
      matches: q === "(prefers-color-scheme: light)" ? osLight : !osLight,
    });
  }
  vm.runInNewContext(`try{${colorModeScript()}}catch(e){}`, sandbox);
  return {
    dark: classes.has("dark"),
    themeColor: meta.content,
    classWrites,
  };
}

const DARK = { dark: true, themeColor: "#0F1012", classWrites: 0 };
const LIGHT = { dark: false, themeColor: "#FFFFFF", classWrites: 1 };

console.log("\npre-paint script — nothing stored (the default)");
eq("OS light, nothing stored → dark, untouched", firstFrame({ osLight: true }), DARK);
eq("OS dark, nothing stored → dark, untouched", firstFrame({ osLight: false }), DARK);

console.log("\npre-paint script — an explicit choice beats the OS");
eq("stored light on a dark OS → light", firstFrame({ stored: "light", osLight: false }), LIGHT);
eq("stored dark on a light OS → dark, untouched", firstFrame({ stored: "dark", osLight: true }), DARK);

console.log("\npre-paint script — System follows the OS");
eq("stored system, OS light → light", firstFrame({ stored: "system", osLight: true }), LIGHT);
eq("stored system, OS dark → dark, untouched", firstFrame({ stored: "system", osLight: false }), DARK);

console.log("\npre-paint script — anything odd falls back to the server's dark frame");
eq("garbage stored → dark", firstFrame({ stored: "sepia", osLight: true }), DARK);
eq("storage throws → dark", firstFrame({ stored: "THROW", osLight: true }), DARK);
eq(
  "system stored but no matchMedia → dark (the throw is caught)",
  firstFrame({ stored: "system", osLight: true, noMatchMedia: true }),
  DARK
);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
