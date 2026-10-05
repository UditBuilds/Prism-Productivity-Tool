import { DEMO_EMAIL } from "@/lib/demo";
import { parseAllowedClientIds, type McpTokenPolicy } from "@/lib/mcp/claims";

/** Where the MCP endpoint lives. Claude's connector URL is <origin> + this. */
export const MCP_PATH = "/api/mcp";

/**
 * RFC 9728 protected-resource metadata for MCP_PATH, path-inserted:
 * /.well-known/oauth-protected-resource/api/mcp. The 401 points here.
 */
export const RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;

/**
 * Scopes requested from Supabase. Supabase supports no custom scopes, and
 * "email" is its default when none is asked for — so this only makes the
 * request explicit. Scopes do NOT limit database access; RLS does.
 */
export const MCP_SCOPES = ["email"] as const;

/** Supabase Auth's issuer — the authorization server for this resource. */
export function authorizationServerIssuer(): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;
}

/**
 * Read per request, never cached at module load, so a changed env var takes
 * effect on the next deployment without anything else to clear.
 */
export function tokenPolicy(nowSeconds = Math.floor(Date.now() / 1000)): McpTokenPolicy {
  return {
    allowedClientIds: parseAllowedClientIds(process.env.MCP_ALLOWED_CLIENT_IDS),
    issuer: authorizationServerIssuer(),
    demoEmail: DEMO_EMAIL,
    nowSeconds,
  };
}
