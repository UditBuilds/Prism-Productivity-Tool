/**
 * Pure rules for the OAuth approval page (app/(auth)/oauth/consent).
 *
 * Kept free of imports so the page, its client component and
 * scripts/test-oauth-consent.mjs all run the same code.
 */

/** Where Supabase sends people to approve: Site URL + Authorization Path. */
export const CONSENT_PATH = "/oauth/consent";

/**
 * Shape check for an `authorization_id`, done BEFORE it reaches Supabase.
 *
 * Supabase generates these as 32 random alphanumeric characters. The check
 * matters because auth-js pastes the id into the Auth API path unencoded
 * (`/oauth/authorizations/${id}/consent`), so an id containing "../" or "?"
 * would aim the signed-in user's token at a different Auth endpoint. Only
 * URL-safe letters, digits, "_" and "-" are accepted — no ".", "/", "?" or
 * "%". The length band is wider than 32 so a future format change fails
 * gracefully rather than locking everyone out.
 */
const AUTHORIZATION_ID = /^[A-Za-z0-9_-]{8,128}$/;

export function isValidAuthorizationId(value: unknown): value is string {
  return typeof value === "string" && AUTHORIZATION_ID.test(value);
}

/**
 * This page's own path for an id — what /login is asked to come back to.
 * Built from a fixed path plus an id that already passed
 * isValidAuthorizationId, so it can never point anywhere else.
 */
export function consentPathFor(authorizationId: string): string {
  return `${CONSENT_PATH}?authorization_id=${encodeURIComponent(authorizationId)}`;
}

/**
 * The only URLs this page will send a browser to are the ones Supabase
 * returns after approve/deny (or for an already-approved request). Even
 * those are checked to be http(s): a `javascript:` or `data:` URL from a
 * misconfigured client must never be navigated to.
 */
export function isSafeRedirectUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Hostname shown to the person before they approve ("claude.ai"). */
export function redirectHostname(redirectUri: string): string | null {
  try {
    return new URL(redirectUri).hostname || null;
  } catch {
    return null;
  }
}

export type ConsentErrorKind = "disabled" | "expired" | "unknown";

/**
 * Map a Supabase error from getAuthorizationDetails to what the page says.
 *
 *  - "disabled": the OAuth server is switched off for the project. Supabase
 *    answers `feature_disabled` (seen live: 404, "OAuth server is disabled").
 *  - "expired": any other 404/410 — the request is unknown, expired or
 *    already used.
 *  - "unknown": everything else, shown with its code for diagnosis.
 */
export function classifyConsentError(error: {
  status?: number;
  code?: string;
}): ConsentErrorKind {
  if (error.code === "feature_disabled") return "disabled";
  if (error.status === 404 || error.status === 410) return "expired";
  return "unknown";
}

