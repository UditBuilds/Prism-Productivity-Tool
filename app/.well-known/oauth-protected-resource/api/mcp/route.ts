import {
  protectedResourceMetadata,
  protectedResourceMetadataPreflight,
} from "@/lib/mcp/http";

/**
 * GET /.well-known/oauth-protected-resource/api/mcp
 *
 * The PRIMARY metadata URL: RFC 9728 §3.1 inserts the well-known segment in
 * front of the resource's path, and the MCP spec lists this form first. The
 * 401 from /api/mcp points here (resource_metadata).
 */
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return protectedResourceMetadata(req);
}

export function OPTIONS() {
  return protectedResourceMetadataPreflight();
}
