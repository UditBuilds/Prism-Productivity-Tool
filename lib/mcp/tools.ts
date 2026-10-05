import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { istDateString } from "@/lib/date";
import { supabaseAsCaller } from "@/lib/mcp/supabase";

/**
 * The tools the Prism MCP server offers. Version 0: one read-only tool that
 * proves the connection acts as the signed-in person and nobody else.
 *
 * Every tool runs as the CALLER: the Supabase client is built from the
 * caller's own access token, so row-level security decides what it can see —
 * exactly as it does for the app.
 */

function jsonResult(body: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    ...(isError ? { isError: true } : {}),
  };
}

export function registerPrismTools(server: McpServer): void {
  server.registerTool(
    "prism_whoami",
    {
      title: "Who am I in Prism",
      description:
        "Shows which Prism account this connection acts as: its email, today's date in India Standard Time, and how many of its tasks are still open. Read-only.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (extra) => {
      const auth = extra.authInfo;
      if (!auth) return jsonResult({ error: "Not signed in." }, true);

      // Same predicate as the dashboard's OPEN counter
      // (app/dashboard/page.tsx): every task not marked done, dated or not.
      // Head-only count: no task rows leave the database.
      const { count, error } = await supabaseAsCaller(auth.token)
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .neq("status", "done");

      if (error) return jsonResult({ error: "Couldn't read your tasks." }, true);

      const email =
        typeof auth.extra?.email === "string" ? auth.extra.email : null;
      return jsonResult({
        email,
        today: istDateString(),
        open_task_count: count ?? 0,
      });
    }
  );
}
