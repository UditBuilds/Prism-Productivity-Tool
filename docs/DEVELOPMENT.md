# Development

How to run, build, and contribute changes to PRISM locally.

## Prerequisites

- **Node.js 18+** and npm
- A **Supabase** project ([supabase.com](https://supabase.com))
- A **Groq** API key ([console.groq.com](https://console.groq.com))
- *(optional)* a **Supadata** key for YouTube → flashcards ([supadata.ai](https://supadata.ai))

## Setup

```bash
git clone https://github.com/UditBuilds/Prism-Productivity-Tool.git
cd Prism-Productivity-Tool
npm install
cp .env.local.example .env.local   # then fill in your keys
```

Apply the database schema by running **`supabase/schema.sql`** in the Supabase
SQL editor. It creates every table with RLS enabled, the `own_*` access
policies, the `updated_at` triggers, and the signup trigger that auto-creates a
`profiles` row.

## Environment variables

See the table in the [README](../README.md#2-configure-environment). Only the
Supabase URL/anon key and `GROQ_API_KEY` are required to boot the app; web push,
the cron secret, and Supadata are optional and gate their respective features.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the dev server at `http://localhost:3000` |
| `npm run build` | Production build (also the strongest correctness check) |
| `npm run start` | Serve a production build |
| `npm run lint` | ESLint (`next lint`) |
| `npm run typecheck` | `tsc --noEmit` — strict type check, no emit |

The service worker / PWA only activates in a production build, so push and
offline behavior won't appear under `npm run dev`.

## Quality gates

Run these three before committing — they must all pass:

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # next lint
npm run build        # next build  (currently 43 routes)
```

## Conventions

- **TypeScript `strict`, no `any`.** `tsconfig` has no `target` (ES5 iteration),
  so wrap `Map`/`Set` iteration in `Array.from()` rather than `for…of` over an
  iterator or spreading it.
- **Dates are IST.** Never do raw `new Date()` day math — use the helpers in
  `lib/date.ts` (`istDayContext`, `istDateString`, `istDayNumber`, …).
- **API routes** check auth first (`createClient()` → `getUser()` → 401), then
  return a `{ data, error }` envelope. Hooks unwrap it and throw on `error`.
- **State**: server data via React Query hooks in `hooks/*`; UI-only state via
  Zustand in `store/*`.
- **Styling**: dark mode only; use the accent tokens (`text-accent`, `bg-accent`,
  …) rather than hard-coded colors so the themeable accent keeps working.
- **Adding a feature** typically means: a route under `app/api/<x>/route.ts`, a
  typed hook in `hooks/use<X>.ts`, and a page under `app/dashboard/<x>/`.

## Repository layout

| Path | Contents |
|------|----------|
| `app/` | App Router pages, layouts, and `api/` route handlers |
| `components/` | Feature UIs, the app shell, and shadcn/ui primitives (`components/ui`) |
| `hooks/` | React Query data hooks (one cache key per domain) |
| `lib/ai`, `lib/pdf`, `lib/youtube` | The three AI ingestion pipelines |
| `lib/srs` | SM-2 algorithm |
| `lib/supabase` | Browser / server / admin clients |
| `lib/date.ts` | IST time helpers (single source of truth) |
| `store/` | Zustand UI stores |
| `types/database.ts` | Hand-authored Supabase types (kept in sync with the schema) |
| `worker/` | Custom service-worker source (push) |
| `scripts/` | `generate-icons.js` (PWA icon generation) |
| `supabase/schema.sql` | Full database schema |

## Gotchas

- **OneDrive can corrupt the `.next` cache** (EINVAL). If a build fails oddly,
  delete `.next` and rebuild.
- **Env changes need a restart** locally and a redeploy on Vercel (Next bakes
  public vars at build time).
- **Pinned stack** — do not upgrade Next, Tailwind, shadcn, `react-day-picker`,
  or `pdf-parse` across majors; the UI relies on the current Radix/Tailwind-v3
  token system.
