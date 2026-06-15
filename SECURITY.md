# Security

PRISM is a private, two-user application. Security is enforced primarily at the
**database layer**, so that an application bug cannot expose another user's data.

## Data isolation model

- **Row-Level Security on every table.** Each table carries a `user_id` and a
  policy of the form `auth.uid() = user_id` (`for all`). Postgres rejects any
  read or write that isn't scoped to the authenticated user — even if the
  application code forgets to filter.
- **Server-side auth on every route.** Each API route handler resolves the
  session with the Supabase server client and returns `401` before doing any
  work. There are no unauthenticated data endpoints.
- **Storage isolation.** Uploaded PDFs live in a private Supabase Storage bucket
  under a `{user_id}/…` prefix; storage policies restrict each user to their own
  folder, and the analyze route verifies the path prefix matches `auth.uid()`
  before reading bytes.
- **Service-role key is server-only.** The Supabase service-role key is used by
  exactly one place — the cron-triggered push endpoint (`/api/push/due`), which
  must read every user's due reminders. It is never shipped to the client and is
  never referenced in a `NEXT_PUBLIC_*` variable.

## Secrets & configuration

- All secrets are provided via environment variables (see `.env.local.example`).
  `.env*.local` is git-ignored and never committed.
- Only variables that are safe for the browser use the `NEXT_PUBLIC_` prefix
  (the Supabase URL, anon key, VAPID public key, and app URL). Everything else
  (`SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `VAPID_PRIVATE_KEY`,
  `CRON_SECRET`, `SUPADATA_API_KEY`) is server-only.
- The push-cron endpoint is guarded by a shared `CRON_SECRET` header, so it
  cannot be invoked by arbitrary callers.

## AI & third-party data flow

- Note/PDF/transcript content is sent to **Groq** for flashcard generation and,
  for YouTube, video IDs are sent to **Supadata** for caption retrieval. No
  credentials or other users' data are included in these requests. Review each
  provider's data-handling policy before processing sensitive material.
- LLM output is parsed and validated server-side; note markdown is HTML-escaped
  before rendering, so stored content is safe to display.

## Supported versions

This is a single actively-developed branch (`master`). Only the latest commit is
maintained.

## Reporting a vulnerability

This is a personal project, but responsible disclosure is welcome. If you find a
security issue, please **open a private report via GitHub Security Advisories**
(repository → *Security* → *Report a vulnerability*) rather than a public issue,
and allow reasonable time for a fix before any disclosure.
