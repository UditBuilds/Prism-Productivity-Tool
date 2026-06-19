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

## 5. Invite your collaborator

PRISM is built for two users. Share the URL; they sign up at `/signup` (email
confirmation is off, so they land on the dashboard immediately). Their data is
fully private — every table has RLS keyed on `user_id`.

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
