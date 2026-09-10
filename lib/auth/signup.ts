/**
 * Rules shared by the signup form and POST /api/signup.
 *
 * Both sides validate. The form validates so the user gets an answer without a
 * round-trip; the route validates because the form is not the only thing that
 * can call it.
 */

/**
 * Minimum password length, matching the rule already enforced on the reset
 * flow (app/(auth)/reset-password/page.tsx) and the `minLength={6}` the signup
 * form has always carried. Supabase's own floor is also 6, so a shorter
 * password would be rejected by Auth anyway — this just says so in our voice
 * instead of surfacing a provider error.
 */
export const MIN_PASSWORD_LENGTH = 6;

/** The one wording for a too-short password. Copied from the reset flow. */
export const SHORT_PASSWORD_MESSAGE = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;

/**
 * Deliberately one message for BOTH "no such code" and "already redeemed".
 *
 * Telling the two apart would turn the form into an oracle: an attacker could
 * confirm which codes exist by reading the wording. The code is the only gate
 * on account creation, so that distinction is not worth the marginal clarity —
 * and for an honest user the remedy is identical either way (ask for a code
 * that works).
 */
export const BAD_INVITE_MESSAGE =
  "That invite code isn't valid or has already been used. Check it and try again, or ask for a new one.";

/**
 * Canonical form of an invite code: trimmed and upper-cased.
 *
 * Codes are typed by hand off a message, so case and stray whitespace must not
 * decide whether someone gets in. Upper-casing is only sound because stored
 * codes are guaranteed upper-case by the `invite_codes_code_upper` CHECK
 * constraint (supabase/schema.sql) — without it, a lower-case code inserted by
 * hand would be permanently unredeemable and nothing would say why.
 *
 * NOTE: the lookup is an exact `.eq()` match on this value, never `like`/
 * `ilike`. A pattern match would let a submitted `%` claim an arbitrary unused
 * code.
 */
export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase();
}
