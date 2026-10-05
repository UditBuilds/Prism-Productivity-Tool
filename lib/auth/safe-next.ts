/**
 * The ONE decision about where a "next" parameter may send someone.
 *
 * Every redirect built from a query parameter goes through this — the auth
 * callback, the login page, and the middleware bounce for signed-in users. A
 * second copy of this rule is how the callback ended up with
 * `${origin}${next}`, which turned `next=@evil.example` into a redirect to
 * evil.example (the `@` makes everything before it a username).
 *
 * The rule: `next` must be a root-relative path that, resolved against the
 * site origin, stays on that origin. Anything else falls back to /dashboard.
 *
 * Pure and dependency-free, so the browser, the Edge middleware and the Node
 * route handlers can all import it.
 */

export const DEFAULT_NEXT_PATH = "/dashboard";

/**
 * Pages a "next" must never point at. Sending a signed-in user back to /login
 * would only bounce them through the middleware again, so it is treated the
 * same as no "next" at all.
 */
const AUTH_PAGES = new Set(["/login", "/signup"]);

/**
 * Return a same-origin `path + query + hash` for `next`, or /dashboard.
 *
 * Checks, in order, and why each one exists:
 *
 *  1. A non-empty string. A missing parameter is the common case.
 *  2. No control characters. The URL parser silently STRIPS tab, CR and LF,
 *     so "/\t/evil.example" would parse as "//evil.example". Rejecting the raw
 *     string is the only way to judge what the user was actually sent.
 *  3. Starts with "/". Only paths this app generates are accepted; a bare
 *     "@evil.example" or "%2F%2Fevil.example" is not one of them.
 *  4. Resolves to the SAME origin. "//evil.example" and "/\evil.example"
 *     (the parser treats "\" as "/") both resolve to another host.
 *  5. The resolved path does not start with "//" or "/\". "/.//evil.example"
 *     keeps the origin but its pathname is "//evil.example" — handed to
 *     router.push or a Location header, that is protocol-relative and leaves
 *     the site. Checks 3 and 4 alone do not catch it.
 *  6. Not an auth page (see AUTH_PAGES).
 */
export function safeNextPath(
  next: string | null | undefined,
  origin: string
): string {
  if (typeof next !== "string" || next.length === 0) return DEFAULT_NEXT_PATH;

  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(next)) return DEFAULT_NEXT_PATH;

  if (!next.startsWith("/")) return DEFAULT_NEXT_PATH;

  let base: URL;
  let resolved: URL;
  try {
    base = new URL(origin);
    resolved = new URL(next, base);
  } catch {
    return DEFAULT_NEXT_PATH;
  }

  if (resolved.origin !== base.origin) return DEFAULT_NEXT_PATH;

  const path = resolved.pathname;
  if (path.startsWith("//") || path.startsWith("/\\")) return DEFAULT_NEXT_PATH;

  if (AUTH_PAGES.has(path)) return DEFAULT_NEXT_PATH;

  return path + resolved.search + resolved.hash;
}
