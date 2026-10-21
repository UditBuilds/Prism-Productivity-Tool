"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { isSafeRedirectUrl } from "@/lib/oauth/consent";
import { Button } from "@/components/ui/button";

type Decision = "approve" | "deny";

/**
 * Allow / Deny for one authorization request.
 *
 * WHERE THE BROWSER GOES NEXT IS SUPABASE'S ANSWER, NOTHING ELSE. Both calls
 * pass `skipBrowserRedirect: true` so auth-js does not navigate on its own;
 * the page then goes to the `redirect_url` Supabase returned — the client's
 * registered redirect URI with the code (or `access_denied`) attached — and
 * only after checking it is an http(s) URL. Nothing from this page's query
 * string is ever a destination.
 *
 * `allowApprove={false}` renders only the cancel path. The server decides
 * that (the demo account); this component does not second-guess it. Note it
 * is a UI rule: Supabase's consent endpoint is reachable directly, so the
 * hard rule — no MCP access for the demo account — lives in the MCP server.
 */
export function ConsentActions({
  authorizationId,
  allowApprove,
}: {
  authorizationId: string;
  allowApprove: boolean;
}) {
  const [pending, setPending] = useState<Decision | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: Decision) {
    // One decision per request: a second tap while the first is in flight
    // (or after it succeeded) does nothing.
    if (pending || leaving) return;
    setError(null);
    setPending(decision);

    const supabase = createClient();
    const result =
      decision === "approve"
        ? await supabase.auth.oauth.approveAuthorization(authorizationId, {
            skipBrowserRedirect: true,
          })
        : await supabase.auth.oauth.denyAuthorization(authorizationId, {
            skipBrowserRedirect: true,
          });

    const url = result.data?.redirect_url;
    if (result.error || !isSafeRedirectUrl(url)) {
      setPending(null);
      const code = result.error?.code ? ` (${result.error.code})` : "";
      setError(
        `That didn't go through${code}. The request may have expired — start the connection again from the app.`
      );
      return;
    }

    setLeaving(true);
    window.location.assign(url);
  }

  const busy = pending !== null || leaving;

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {allowApprove && (
        <Button
          type="button"
          onClick={() => decide("approve")}
          disabled={busy}
          className="h-11 w-full rounded-lg"
        >
          {pending === "approve" && <Loader2 className="animate-spin" />}
          Allow
        </Button>
      )}

      <Button
        type="button"
        variant="outline"
        onClick={() => decide("deny")}
        disabled={busy}
        className="h-11 w-full rounded-lg"
      >
        {pending === "deny" && <Loader2 className="animate-spin" />}
        {allowApprove ? "Deny" : "Cancel this request"}
      </Button>

      {leaving && (
        <p className="text-center text-xs text-muted-foreground" role="status">
          Taking you back…
        </p>
      )}
    </div>
  );
}
