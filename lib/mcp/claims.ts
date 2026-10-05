/**
 * Pure rules for which bearer tokens the MCP server accepts.
 *
 * NO IMPORTS, on purpose: scripts/test-mcp-claims.mjs loads this file on its
 * own, and the decision is the security boundary of /api/mcp — it should be
 * readable and testable in one place without a network.
 *
 * WHY client_id IS THE GATE. Supabase OAuth access tokens and ordinary
 * browser-session tokens look almost identical: same issuer, same signing
 * key, `aud: "authenticated"`, `role: "authenticated"`. Audience binding
 * (RFC 8707) is not available, so the one claim that says "this token was
 * issued to an app the owner approved" is `client_id` — present on OAuth
 * tokens, absent on browser sessions. Requiring it, and requiring it to be on
 * an allowlist, is what stops a leaked browser token from working here.
 */

export interface McpTokenPolicy {
  /** OAuth client ids allowed to call the MCP server. Empty → nobody. */
  allowedClientIds: readonly string[];
  /** The only issuer accepted: `<supabase url>/auth/v1`. */
  issuer: string;
  /** The public demo account's email — never accepted (its password is public). */
  demoEmail: string;
  /** "Now" in epoch seconds; a parameter so tests are deterministic. */
  nowSeconds: number;
}

export type ClaimsDecision =
  | {
      ok: true;
      userId: string;
      email: string | null;
      clientId: string;
      expiresAt: number;
    }
  | { ok: false; reason: string };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Signing algorithms accepted. Asymmetric only: these verify locally against
 * the project's public JWKS. An HS256 token (or one without a `kid`) would
 * make supabase-js fall back to a network round-trip to the Auth server
 * instead of a local check — and nothing this server should accept is
 * signed that way (the project signs with ES256).
 */
const ASYMMETRIC_ALGS = new Set(["ES256", "RS256"]);

/** MCP_ALLOWED_CLIENT_IDS → a clean list: comma-separated, trimmed, no blanks. */
export function parseAllowedClientIds(raw: string | null | undefined): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * The JOSE header of a JWT, decoded WITHOUT verifying anything — used only to
 * refuse non-asymmetric tokens before verification is attempted.
 */
export function readJwtHeader(
  token: string
): { alg?: unknown; kid?: unknown } | null {
  const first = token.split(".")[0];
  if (!first) return null;
  try {
    const base64 = first.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const parsed: unknown = JSON.parse(atob(padded));
    return parsed && typeof parsed === "object"
      ? (parsed as { alg?: unknown; kid?: unknown })
      : null;
  } catch {
    return null;
  }
}

export function isAcceptedSigningHeader(
  header: { alg?: unknown; kid?: unknown } | null
): boolean {
  return (
    !!header &&
    typeof header.alg === "string" &&
    ASYMMETRIC_ALGS.has(header.alg) &&
    typeof header.kid === "string" &&
    header.kid.length > 0
  );
}

/**
 * Decide on claims that have ALREADY passed signature and expiry checks
 * (supabase.auth.getClaims). Every rule is a reason to say no; the order only
 * affects which reason is reported.
 */
export function evaluateClaims(
  claims: Record<string, unknown>,
  policy: McpTokenPolicy
): ClaimsDecision {
  if (policy.allowedClientIds.length === 0) {
    return { ok: false, reason: "no clients are allowed" };
  }
  if (claims.iss !== policy.issuer) {
    return { ok: false, reason: "token is from another issuer" };
  }
  if (claims.role !== "authenticated") {
    return { ok: false, reason: "token is not a signed-in user's" };
  }
  const aud = claims.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes("authenticated")) {
    return { ok: false, reason: "token has the wrong audience" };
  }
  if (typeof claims.sub !== "string" || !UUID.test(claims.sub)) {
    return { ok: false, reason: "token has no user id" };
  }
  if (claims.is_anonymous === true) {
    return { ok: false, reason: "anonymous users are not accepted" };
  }
  if (typeof claims.exp !== "number" || claims.exp <= policy.nowSeconds) {
    return { ok: false, reason: "token has expired" };
  }
  const clientId = claims.client_id;
  if (typeof clientId !== "string" || clientId.length === 0) {
    // A browser session token lands here: no client_id at all.
    return { ok: false, reason: "token was not issued to an app" };
  }
  if (!policy.allowedClientIds.includes(clientId)) {
    return { ok: false, reason: "token was issued to an app that is not allowed" };
  }
  const email = typeof claims.email === "string" ? claims.email : null;
  if (email !== null && email.toLowerCase() === policy.demoEmail.toLowerCase()) {
    return { ok: false, reason: "the demo account cannot connect apps" };
  }
  return {
    ok: true,
    userId: claims.sub,
    email,
    clientId,
    expiresAt: claims.exp,
  };
}
