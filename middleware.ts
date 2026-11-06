import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image
     * - favicon.ico, image files
     * - /api/mcp and /.well-known/oauth-protected-resource[/…]: the MCP
     *   server and its metadata. They authenticate with a Bearer token, not
     *   cookies, so the cookie-session refresh here is a wasted Auth call —
     *   and this middleware must never be able to redirect Claude's calls
     *   to /login.
     * Every other API and page route still runs it so the session stays
     * fresh.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/mcp(?:/|$)|\\.well-known/oauth-protected-resource(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
