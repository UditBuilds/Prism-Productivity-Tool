# Deployment

Deploy PRISM (Next.js 14 + Supabase + Groq) to Vercel in ~15 minutes.

## Prerequisites

- A Supabase project with the schema applied (`supabase/schema.sql`) and RLS enabled.
- A Groq API key from [console.groq.com/keys](https://console.groq.com/keys) (free, no card).
- *(optional)* a Supadata API key for YouTube → flashcards ([supadata.ai](https://supadata.ai)).
- A GitHub account and a Vercel account.

## 1. Push to GitHub

```bash
git remote add origin <your-repo-url>   # or: git remote set-url origin <your-repo-url>
git push -u origin master
```

## 2. Import into Vercel

1. [vercel.com/new](https://vercel.com/new) → **Add New… → Project** → **Import** your repo.
2. **Framework Preset:** Next.js (auto-detected) — leave build/output settings at defaults.
3. Add **Environment Variables** (Production + Preview):

   | Name | Value |
   |------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (keep secret) |
   | `GROQ_API_KEY` | Groq API key |
   | `NEXT_PUBLIC_APP_URL` | Deployed URL, e.g. `https://prism-xyz.vercel.app` |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push public key (`npx web-push generate-vapid-keys`) |
   | `VAPID_PRIVATE_KEY` | Web Push private key (keep secret) |
   | `VAPID_SUBJECT` | `mailto:you@example.com` |
   | `CRON_SECRET` | Random string guarding `/api/push/due` (keep secret) |
   | `SUPADATA_API_KEY` | *(optional)* YouTube → flashcards |

   Find the Supabase values in **Supabase → Project Settings → API**. Generate the
   VAPID pair once with `npx web-push generate-vapid-keys` and reuse the same pair
   in `.env.local` and Vercel.
4. **Deploy.**

## 3. Supabase URL configuration (critical)

After the first deploy, copy your Vercel URL, then in
**Supabase → Authentication → URL Configuration** set:

- **Site URL:** `https://prism-xyz.vercel.app`
- **Redirect URLs:** add `https://prism-xyz.vercel.app/**`

Without this, auth redirects and the `/api/auth/callback` flow fail on the live
domain even though they work locally. The change takes effect immediately (no
redeploy needed). Add any custom domain to both fields too.

## 4. Schedule reminder pushes (optional)

To deliver reminder notifications while the app is closed, schedule a job that
calls the cron endpoint every minute. In the Supabase SQL editor, use
`pg_cron` + `pg_net` to `POST` to `https://<your-app>/api/push/due` with an
`x-cron-secret` header equal to your `CRON_SECRET`. The `push_subscriptions`
table (in `supabase/schema.sql`) must exist first, and users must enable
notifications from **Settings** (iOS requires the installed PWA).

## 4a. Schedule recurring-task spawning

`/api/cron/recurring-tasks` materialises today's task from each active
`recurring_tasks` template (idempotent — one task per template per IST day).
Schedule it for **00:05 IST daily** with the same `pg_cron` + `pg_net` pattern.
`pg_cron` runs in **UTC**, so 00:05 IST = **18:35 UTC** (`35 18 * * *`):

```sql
select cron.schedule(
  'prism-recurring-tasks',
  '35 18 * * *',                       -- 00:05 IST daily (pg_cron is UTC; IST = UTC+5:30)
  $$
  select net.http_post(
    url     := 'https://<your-app>/api/cron/recurring-tasks',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', '<your CRON_SECRET>'
    )
  );
  $$
);
```

The `recurring_tasks` table and the `tasks.recurring_task_id` column must exist
first. Verify the job with `select * from cron.job;` and inspect runs via
`select * from cron.job_run_details order by start_time desc;`.

## 5. Adding another user

PRISM is an invite-only private beta. `/signup` takes an invite code and
posts to `POST /api/signup`, which redeems it with the service-role key and
creates the account via the Supabase Admin API. There is no user-limit
enforced in code.

To add a user, mint a code and send it to them:

```sql
insert into public.invite_codes (code) values ('PRISM-AB12CD34')
returning code;
```

Codes must be UPPER-CASE — the `invite_codes_code_upper` CHECK rejects
anything else, because the route upper-cases what the user types before
matching. Each code is single-use: redeeming it sets `used`, `used_by` and
`used_at`. Email confirmation is off, so the new user lands on the dashboard
immediately. Each user's data is fully private — every table has RLS keyed on
`user_id`.

⚠️ **The invite gate only holds if self-serve signup is OFF in Supabase.**
Authentication → Sign In / Providers → "Allow new users to sign up" must be
disabled. While it is on, anyone can create an account by POSTing to
`/auth/v1/signup` with the anon key out of the browser bundle, and the invite
code is not consulted at all. Re-check it with:

```bash
curl -s -o /dev/null -w '%{http_code}
' -X POST "$URL/auth/v1/signup"   -H "apikey: $ANON_KEY" -H "Content-Type: application/json"   -d '{"email":"probe@example.com","password":"ProbePassword123!"}'
```

`422` is the setting working. `200` means it is still open — and that a real
account was just created, so delete it.

## 5a. The public demo account

Signups being closed leaves no way for a recruiter or hiring manager to try
the app, so the login page carries a **Try the demo** button. It calls the same
`supabase.auth.signInWithPassword` the normal form does, with the credentials
in `lib/demo.ts` — nothing is minted server-side.

The account is writable on purpose (a task app nobody can touch proves
nothing), so it is wiped and re-seeded nightly by a database function:

1. Run **`supabase/demo-seed.sql`** in the Supabase SQL Editor. It creates
   `public.reset_demo_account()` and registers the `prism-demo-reset` cron job.
2. Verify with the queries at the bottom of that file, **one at a time** — the
   SQL Editor only shows the last statement's result.

Two things about this job differ from the reminder/recurring jobs above and
are deliberate:

- **It runs SQL directly, not `net.http_post`.** It mirrors `prism-log-prune`,
  the existing in-database job. Reseeding needs no application code, and a
  direct call reports its true outcome in `cron.job_run_details` instead of
  the "queued" that `net.http_post` reports regardless of what the endpoint
  did.
- **The schedule is `30 21 * * *`, which is 03:00 IST.** pg_cron evaluates
  schedules in the database timezone and this database is UTC. `0 3 * * *`
  would fire at 08:30 IST.

Everything the function touches is filtered on the demo UUID alone, and it
aborts with an exception if that UUID stops resolving to `demo@prismapp.dev`.

Known and accepted: someone using the demo when the reset fires loses their
in-flight changes and sees the fresh seed on next load.

## Troubleshooting

- **Auth redirect loops / "redirect not allowed":** revisit step 3 — the Vercel
  URL must be in Supabase's Site URL and Redirect URLs.
- **Flashcard generation returns 500:** check `GROQ_API_KEY` is set and the Groq
  project has quota. Server logs print the real error.
- **YouTube → flashcards fails:** confirm `SUPADATA_API_KEY` is set; transcript
  availability and rate limits depend on the provider.
- **Env var changes not taking effect:** Vercel bakes env vars at build time —
  **redeploy** after editing them.
- **Reproduce a failing build locally** with `npm run build` before pushing.
