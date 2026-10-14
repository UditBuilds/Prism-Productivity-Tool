import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * Supabase clients for the MCP server. ANON KEY ONLY — the service-role key
 * must never be reachable from MCP code (scripts/test-mcp-no-service-role.mjs
 * fails the build's test step if any MCP entry point imports it, directly or
 * through another module).
 */

const NO_SESSION = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

let verifier: ReturnType<typeof createClient> | null = null;

/**
 * One client per warm instance for token VERIFICATION only. getClaims checks
 * an ES256/RS256 token's signature locally against the project's JWKS, which
 * supabase-js caches in memory for 10 minutes — so most requests make no
 * network call to verify.
 */
export function tokenVerifier() {
  verifier ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: NO_SESSION }
  );
  return verifier;
}

/**
 * A client that acts AS the caller: anon key plus the caller's own access
 * token, so PostgREST applies the same row-level security the app does. Built
 * per tool call and never stored.
 *
 * Its storageKey differs from the verifier's so the two never share auth
 * state.
 */
export function supabaseAsCaller(accessToken: string) {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { ...NO_SESSION, storageKey: "prism-mcp-caller" },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }
  );
}
