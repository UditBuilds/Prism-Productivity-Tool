import { createMcpHandler } from "mcp-handler";

import { withPrismAuth } from "@/lib/mcp/http";
import { registerPrismTools } from "@/lib/mcp/tools";

/**
 * POST /api/mcp — Prism's MCP server (Streamable HTTP, stateless).
 *
 * Claude (web, desktop, phone) calls this from Anthropic's cloud with an
 * OAuth access token issued by Supabase's OAuth 2.1 server. withPrismAuth
 * turns away anything else with a 401 that points at the protected-resource
 * metadata; see lib/mcp/http.ts and lib/mcp/claims.ts for the rules.
 *
 * Stateless: mcp-handler builds a fresh McpServer per request and no session
 * id is issued, so any serverless instance can answer any request. GET and
 * DELETE answer 405 (no server-to-client stream, no sessions to end). SSE is
 * disabled — it is the deprecated transport and would need Redis.
 */

// mcp-handler uses node:http / node:net — never the Edge runtime.
export const runtime = "nodejs";
// Per-caller answers: never prerendered or cached.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const handler = createMcpHandler(
  registerPrismTools,
  { serverInfo: { name: "prism", version: "0.1.0" } },
  { basePath: "/api", disableSse: true, maxDuration: 30, verboseLogs: false }
);

const gated = withPrismAuth(handler);

export { gated as GET, gated as POST, gated as DELETE };
