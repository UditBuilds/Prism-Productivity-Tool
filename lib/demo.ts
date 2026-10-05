/**
 * The public demo account.
 *
 * Prism's signups are invite-only: /signup requires a code, redeemed
 * server-side by POST /api/signup. This account is the way in for anyone
 * WITHOUT a code — a recruiter opening the portfolio link, mostly.
 *
 * THE PASSWORD BEING IN CLIENT CODE IS THE DESIGN, NOT AN OVERSIGHT. The
 * button below signs in with `supabase.auth.signInWithPassword` exactly as the
 * normal form does, so these credentials reach the browser either way — a
 * visitor could equally read them off a README. Hiding them would mean minting
 * a session server-side instead, which this project has explicitly ruled out.
 * What keeps the blast radius at zero is elsewhere:
 *
 *   - the account owns nothing real, and every row it does own is deleted and
 *     re-seeded nightly by public.reset_demo_account() (supabase/demo-seed.sql)
 *   - RLS scopes it to its own rows like any other user
 *   - it is not an admin of anything
 *
 * Keep this in sync with the `demo_id` constant in supabase/demo-seed.sql —
 * the seed is keyed on the UUID, this is keyed on the email, and they describe
 * the same account.
 */
export const DEMO_EMAIL = "demo@prismapp.dev";
export const DEMO_PASSWORD = "PrismDemo2026!";

/**
 * The same account's user id — `demo_id` in supabase/demo-seed.sql.
 *
 * For checks that must hold even if the account's email were changed: the
 * password is public, so the email is not a reliable way to recognise this
 * account. The id never changes. Used by the MCP server to refuse it.
 */
export const DEMO_USER_ID = "eac085cc-54df-4414-9c43-08a6ce84ecea";
