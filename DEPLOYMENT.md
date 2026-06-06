# Prism — Deployment Guide

Deploy Prism (Next.js 14 + Supabase + Groq) to Vercel. Takes ~15 minutes.

## Prerequisites

- A Supabase project with the schema applied (`supabase/schema.sql`) and RLS enabled.
- A Groq API key from [console.groq.com/keys](https://console.groq.com/keys) (free, no card).
- A GitHub account and a Vercel account.

## 1. GitHub

1. Create a new **private** repo at [github.com/new](https://github.com/new) (don't add a README/.gitignore — the project already has them).
2. From the project root, point the repo at it and push:
   ```bash
   git remote add origin <your-repo-url>
   git push -u origin master
   ```
   If a remote named `origin` already exists, use `git remote set-url origin <your-repo-url>` instead.

## 2. Vercel

1. Go to [vercel.com/new](https://vercel.com/new) → **Add New… → Project**.
2. **Import** your GitHub repo.
3. **Framework Preset:** Next.js (auto-detected). Leave build/output settings at their defaults.
4. Open **Environment Variables** and add all of these (Production + Preview):

   | Name | Value |
   |------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | your Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your Supabase anon/public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | your Supabase service-role key (keep secret) |
   | `GROQ_API_KEY` | your Groq API key |
   | `NEXT_PUBLIC_APP_URL` | your deployed URL, e.g. `https://prism-xyz.vercel.app` |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push public key (`npx web-push generate-vapid-keys`) |
   | `VAPID_PRIVATE_KEY` | Web Push private key (keep secret) |
   | `VAPID_SUBJECT` | `mailto:you@example.com` (contact for push services) |
   | `CRON_SECRET` | random string guarding `/api/push/due` (keep secret) |

   (Find the Supabase values in **Supabase → Project Settings → API**. Generate the
   VAPID pair once with `npx web-push generate-vapid-keys` and reuse the same pair
   in `.env.local` and Vercel.)
5. Click **Deploy** and wait for the build to finish.

> **Web Push (Session 8):** after deploying, schedule the 1-minute reminder check so
> pushes fire while the app is closed. Run the `pg_cron` SQL from the Session 8 notes in
> the Supabase SQL editor — it calls `POST /api/push/due` with the `x-cron-secret` header
> matching `CRON_SECRET`. The `push_subscriptions` table (in `supabase/schema.sql`) must
> exist first.

## 3. Supabase URL Configuration (CRITICAL)

After the first deploy, copy your Vercel URL (e.g. `https://prism-xyz.vercel.app`), then in
**Supabase → Authentication → URL Configuration** set:

- **Site URL:** `https://prism-xyz.vercel.app`
- **Redirect URLs:** add `https://prism-xyz.vercel.app/**`

Without this, auth (login/signup redirects and the `/api/auth/callback` flow) will fail on the
live domain even though it works locally. Re-deploy is **not** required after changing this —
the change takes effect immediately.

> Tip: if you add a custom domain later, add it to both fields too.

## 4. Invite your collaborator

1. Share the Vercel URL with them.
2. They go to `/signup` and create their account (email confirmation is **off**, so they land on
   the dashboard immediately).
3. Their data is fully private from yours — every table has Row Level Security keyed on `user_id`.

## Troubleshooting

- **Auth redirect loops / "redirect not allowed":** revisit step 3 — the Vercel URL must be in
  Supabase's Site URL and Redirect URLs.
- **Flashcard generation returns 500:** check `GROQ_API_KEY` is set in Vercel and the Groq project
  has quota ([console.groq.com](https://console.groq.com)). Server logs print the real error.
- **Env var changes not taking effect:** Vercel bakes env vars at build time — **redeploy** after
  editing them (Deployments → ⋯ → Redeploy).
- **Build fails locally first:** run `npm run build` to reproduce before pushing.
