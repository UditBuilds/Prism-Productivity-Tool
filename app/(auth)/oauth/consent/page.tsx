import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { DEMO_EMAIL } from "@/lib/demo";
import {
  classifyConsentError,
  consentPathFor,
  isBackgroundPageFetch,
  isSafeRedirectUrl,
  isValidAuthorizationId,
  redirectHostname,
} from "@/lib/oauth/consent";
import {
  ConsentNotice,
  ConsentScreen,
  DemoRefusal,
} from "@/components/oauth/ConsentScreens";

export const metadata = {
  title: "Connect an app | Prism",
  robots: { index: false, follow: false },
};

// Per-person, per-request page: never prerendered, never cached.
export const dynamic = "force-dynamic";

/**
 * The OAuth approval page — Supabase's "Authorization Path".
 *
 * An app (Claude) asks Supabase for access; Supabase sends the person here
 * with `?authorization_id=…`. The checks run in this order, and the order is
 * load-bearing:
 *
 *  1. Background fetch → 404. next-pwa's front-end-navigation Worker
 *     re-fetches this URL to cache it; a 404 is the one answer it skips.
 *     Before the sign-in check, or it would cache /login under this URL.
 *  2. authorization_id shape — before it goes anywhere near Supabase (see
 *     isValidAuthorizationId for why the shape matters).
 *  3. Signed out → /login?next=<this exact path and query>.
 *  4. Demo account → refusal. BEFORE asking Supabase for details: for a
 *     request that was already approved, getAuthorizationDetails answers
 *     with a redirect_url carrying a live code.
 *  5. Details → the Allow / Deny screen; an already-approved request goes
 *     straight back to the app; an error gets a plain-words message.
 */
export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: { authorization_id?: string | string[] };
}) {
  if (isBackgroundPageFetch(headers())) notFound();

  const rawId = searchParams.authorization_id;
  if (rawId === undefined) return <ConsentNotice kind="missing" />;
  // A repeated parameter arrives as an array and fails here too.
  if (!isValidAuthorizationId(rawId)) return <ConsentNotice kind="invalid" />;
  const authorizationId = rawId;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(consentPathFor(authorizationId))}`);
  }

  if (user.email?.toLowerCase() === DEMO_EMAIL) {
    return <DemoRefusal authorizationId={authorizationId} />;
  }

  const { data, error } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

  if (error || !data) {
    return (
      <ConsentNotice
        kind={classifyConsentError(error ?? {})}
        code={error?.code ?? undefined}
      />
    );
  }

  // Approved earlier for these scopes: Supabase hands back the app's
  // redirect with a fresh code. Go there — and only there.
  if ("redirect_url" in data) {
    if (isSafeRedirectUrl(data.redirect_url)) redirect(data.redirect_url);
    return <ConsentNotice kind="unknown" />;
  }

  return (
    <ConsentScreen
      authorizationId={authorizationId}
      clientName={data.client?.name?.trim() || "An app"}
      email={data.user?.email ?? user.email ?? ""}
      returnHost={redirectHostname(data.redirect_uri)}
    />
  );
}
