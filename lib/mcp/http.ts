import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import { evaluateClaims, isAcceptedSigningHeader, readJwtHeader } from "@/lib/mcp/claims";
import {
  MCP_PATH,
  MCP_SCOPES,
  RESOURCE_METADATA_PATH,
  authorizationServerIssuer,
  tokenPolicy,
} from "@/lib/mcp/config";
import { tokenVerifier } from "@/lib/mcp/supabase";

/**
 * The HTTP edge of the MCP server: who may call it, and what a refusal looks
 * like. NOTHING HERE LOGS A TOKEN, a header, or any part of either — refusals
 * carry a fixed reason string and nothing from the request.
 */

/** The origin the caller used — the MCP URL and metadata URL are built on it. */
function origin(req: Request): string {
  return new URL(req.url).origin;
}

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * 401 with the challenge the MCP spec and RFC 9728 §5.1 require:
 * `WWW-Authenticate: Bearer resource_metadata="…"`, plus `scope` (MCP spec:
 * SHOULD). RFC 6750 §3.1: a request with NO credentials gets no error code;
 * a request with a bad one gets error="invalid_token".
 */
export function unauthorized(req: Request, tokenSent: boolean): Response {
  const params = [
    `resource_metadata="${origin(req)}${RESOURCE_METADATA_PATH}"`,
    `scope="${MCP_SCOPES.join(" ")}"`,
  ];
  if (tokenSent) {
    params.push(
      `error="invalid_token"`,
      `error_description="The access token is missing, invalid, expired, or not allowed"`
    );
  }
  return new Response(
    JSON.stringify(
      tokenSent
        ? { error: "invalid_token", error_description: "The access token is missing, invalid, expired, or not allowed" }
        : { error: "unauthorized", error_description: "Authorization required" }
    ),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer ${params.join(", ")}`,
        ...NO_STORE,
      },
    }
  );
}

/** The Bearer token from the Authorization header, or null. Never the query string. */
function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * Verify a bearer token and turn it into the AuthInfo mcp-handler hands to
 * tools as `extra.authInfo`. Returns null for anything not accepted.
 *
 * 1. Asymmetric signature with a key id, checked BEFORE verification, so
 *    verification is always local (see isAcceptedSigningHeader).
 * 2. supabase.auth.getClaims: signature against the project's JWKS + expiry.
 * 3. evaluateClaims: issuer, role, audience, user id, not anonymous, not
 *    expired, client_id on MCP_ALLOWED_CLIENT_IDS, not the demo account.
 */
export async function verifyBearer(token: string): Promise<AuthInfo | null> {
  if (!isAcceptedSigningHeader(readJwtHeader(token))) return null;

  const { data, error } = await tokenVerifier().auth.getClaims(token);
  if (error || !data) return null;

  const decision = evaluateClaims(
    data.claims as unknown as Record<string, unknown>,
    tokenPolicy()
  );
  if (!decision.ok) return null;

  return {
    token,
    clientId: decision.clientId,
    scopes: [],
    expiresAt: decision.expiresAt,
    extra: { userId: decision.userId, email: decision.email },
  };
}

/**
 * Gate an mcp-handler route: no valid token → 401; valid → the request goes
 * through with `req.auth` set, which is where mcp-handler 1.1.0 reads the
 * caller's AuthInfo from (it passes it to the transport as `authInfo`).
 *
 * Every response leaves with Cache-Control: no-store.
 */
export function withPrismAuth(
  handler: (req: Request) => Promise<Response>
): (req: Request) => Promise<Response> {
  return async (req) => {
    const token = bearerToken(req);
    if (!token) return unauthorized(req, req.headers.has("authorization"));

    const auth = await verifyBearer(token);
    if (!auth) return unauthorized(req, true);

    (req as Request & { auth?: AuthInfo }).auth = auth;
    const res = await handler(req);
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
}

const METADATA_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
} as const;

/**
 * RFC 9728 protected-resource metadata. Served at BOTH well-known paths (see
 * the route files); `resource` is the MCP URL itself in both, because Claude
 * compares it to the connector URL exactly.
 */
export function protectedResourceMetadata(req: Request): Response {
  const body = {
    resource: `${origin(req)}${MCP_PATH}`,
    authorization_servers: [authorizationServerIssuer()],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Prism",
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...METADATA_CORS,
      ...NO_STORE,
    },
  });
}

/** CORS preflight for the metadata paths (browser-based MCP clients). */
export function protectedResourceMetadataPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: { ...METADATA_CORS, "Access-Control-Max-Age": "86400" },
  });
}
