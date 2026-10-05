import { NextResponse } from "next/server";

import { safeNextPath } from "@/lib/auth/safe-next";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / email-confirmation callback.
 * Exchanges the `code` from the redirect for a session, then forwards
 * the user on to `next` (defaults to the dashboard).
 *
 * `next` goes through safeNextPath and is resolved as a URL, never
 * concatenated: the old `${origin}${next}` let `next=@evil.example` send a
 * freshly signed-in user to evil.example.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"), origin);

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
