import {
  protectedResourceMetadata,
  protectedResourceMetadataPreflight,
} from "@/lib/mcp/http";

/**
 * GET /.well-known/oauth-protected-resource
 *
 * The FALLBACK metadata URL. MCP clients that can't use the 401's
 * resource_metadata pointer probe the path-inserted URL first, then this
 * root one (MCP spec 2025-11-25 "Protected Resource Metadata Discovery";
 * Claude's connector docs describe the same order).
 *
 * `resource` here is the MCP URL (<origin>/api/mcp), not the bare origin:
 * Claude compares it to the connector URL exactly. This is the only resource
 * this origin protects.
 */
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return protectedResourceMetadata(req);
}

export function OPTIONS() {
  return protectedResourceMetadataPreflight();
}
