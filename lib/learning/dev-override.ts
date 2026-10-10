/**
 * Dev-only test hooks for Learning (LEARNING_TEST_DAILY_CAP,
 * LEARNING_TEST_WRITE_MAX_TOKENS, LEARNING_DEBUG_DIR), so failure paths and
 * single test lessons can be run for real on a local machine.
 *
 * How it is kept out of production — two independent gates, either one
 * enough:
 *   1. NODE_ENV. `next build` compiles `process.env.NODE_ENV` into the server
 *      bundle as the literal "production", so in any production build the
 *      first check is constant-true and no runtime environment variable can
 *      change it.
 *   2. VERCEL. Vercel sets VERCEL=1 for every build and every function at
 *      runtime, preview deployments included, so even a build made with a
 *      non-production NODE_ENV is refused there.
 * No dependencies, so scripts/test-learning.mjs pins both gates.
 */

/** True only on a local development run: never in a production build, never on Vercel. */
export function isLocalDevRuntime(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.VERCEL) return false;
  return true;
}

/** A positive number from the named variable on a local development run; otherwise null. */
export function devOverride(name: string): number | null {
  if (!isLocalDevRuntime()) return null;
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
