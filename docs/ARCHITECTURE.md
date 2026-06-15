# Architecture

PRISM is a Next.js 14 (App Router) application backed by Supabase. This document
explains how the pieces fit together and the engineering decisions behind them.

## System overview

```
┌──────────────────────────────────────────────────────────────────┐
│ Browser (installable PWA)                                         │
│   React Query  ── server cache, optimistic updates, prefetch      │
│   Zustand      ── UI-only state (modals, timer, review session)   │
│   Service Worker ── offline shell + Web Push handling             │
└───────────────┬──────────────────────────────────────────────────┘
                │ fetch (JSON, { data, error })
                ▼
┌──────────────────────────────────────────────────────────────────┐
│ Next.js App Router                                                │
│   Server Components ── auth gate, initial data (dashboard, learn) │
│   Route Handlers /app/api/* ── auth-guarded JSON endpoints        │
└───────┬───────────────────┬───────────────────┬──────────────────┘
        ▼                   ▼                   ▼
   Supabase Postgres   Groq (LLaMA 3.3)   Supadata (transcripts)
   + RLS + Storage
        ▲
        │ pg_cron (1-min) → POST /api/push/due (x-cron-secret)
        ▼
   Web Push → device
```

## Layers

### 1. Rendering & routing
- **App Router** with a real `dashboard/` segment (not a route group). Auth-only
  pages live under it; the layout resolves the session server-side and redirects
  unauthenticated users.
- **Server Components** handle the auth gate and a few server-rendered reads
  (e.g. the dashboard's "due today"). Everything interactive is a client
  component hydrated with React Query.
- **Route Handlers** under `app/api/**` are the data plane. Each one:
  1. creates a Supabase server client and calls `getUser()` (401 if absent),
  2. validates input,
  3. returns a uniform `{ data, error }` envelope.

### 2. State management
- **Server state → React Query.** One cache key per domain (`["tasks"]`,
  `["notes"]`, `["srs-cards"]`, …). Hooks live in `hooks/*` and expose query
  options that are reused by a background **prefetcher** so navigating between
  pages hits a warm cache.
- **UI state → Zustand** (`store/ui.store.ts`, `store/focus.store.ts`) — modal
  open/close, the focus timer, and the in-progress SRS review session.
- **Derived-cache invalidation.** Calendar, productivity analytics, and weekly
  review are *read-models* computed from the activity tables. A small map
  (`lib/derived-caches.ts`) lets each mutation invalidate exactly the dependent
  read-models, so dashboards never show stale aggregates.

### 3. Data & security
- **Postgres via Supabase**, typed by a hand-authored `types/database.ts` kept in
  sync with `supabase/schema.sql`.
- **Row-Level Security on every table** — `auth.uid() = user_id`. Isolation is
  enforced by the database, not by hopeful application filters. See
  [SECURITY.md](../SECURITY.md).
- **Three Supabase clients**: a browser client, a server client (per-request,
  cookie-bound), and an admin (service-role) client used *only* by the cron push
  endpoint.

### 4. Time (IST discipline)
All civil-date logic is anchored to **Asia/Kolkata** through `lib/date.ts`. Raw
`new Date()` day arithmetic is banned because the server runs in UTC and would
otherwise miscompute "due today," streak days, weekly boundaries, and the
calendar grid. Helpers convert between epoch instants and IST day indices /
date strings; the calendar's Monday-first weekday math is derived from the IST
day index rather than the local time zone.

## AI ingestion pipelines

Three sources converge on one output (`{ front, back }[]`) and one review queue.

### Notes → flashcards
`lib/ai/client.ts` (server-only) sends note content to **Groq / LLaMA 3.3 70B**,
then parses and validates the JSON array of cards.

### PDF → flashcards (storage-backed)
The most involved pipeline, designed around the serverless ~4.5 MB request-body
limit:
1. The client uploads the PDF **directly to a private Storage bucket** (25 MB
   cap), so file bytes never transit the API body.
2. `/api/pdf/analyze` receives only JSON (`{ path, mode, … }`), downloads the
   file, and verifies the path prefix equals `auth.uid()`.
3. `lib/pdf/extract.ts` pulls per-page text via `pdf-parse`. Three modes —
   **quick** (first pages), **smart** (evenly sampled across long docs), and
   **range** (validated page span).
4. `lib/pdf/chunk.ts` splits text on sentence boundaries; chunks are sent to the
   LLM **sequentially** (rate-limit friendly).
5. `lib/pdf/merge-cards.ts` interleaves results round-robin and drops
   near-duplicates via content-word **Jaccard similarity** (> 0.75).
6. Typed `PdfAnalyzeError` codes map to recovery hints in the UI. There is **no
   OCR** — scanned PDFs fail honestly with a `SCANNED_PDF` error. The temp upload
   is deleted in a `finally` block.

### YouTube → flashcards
`lib/youtube/extract.ts` fetches captions from the **Supadata transcript API**
(`x-api-key` auth) — chosen over scraping because it works reliably from
datacenter IPs like Vercel's. Transcript text is cleaned of caption noise,
chunked, and run through the same generation + merge stage.

## Spaced repetition

`lib/srs/sm2.ts` is a hand-written **SM-2** implementation. Reviews record a
grade (Again/Hard/Good/Easy); the algorithm updates ease factor, repetition
count, and interval. The **streak** is computed server-side in
`/api/srs/analytics` from review dates unioned with **freeze** dates: when a
single-day gap would break the streak, the route auto-spends one of three weekly
freezes (idempotently, via `INSERT … ON CONFLICT DO NOTHING` plus an
inserted-row check) and surfaces the protection in the UI.

## Notifications

- **In-app**: a poller fires the browser Notification API for due reminders.
- **Background**: a custom service worker (`worker/index.ts`) handles Web Push.
  `pg_cron` calls `/api/push/due` every minute with a `CRON_SECRET` header; the
  endpoint uses the admin client to find due reminders, sends pushes via VAPID,
  prunes dead subscriptions, and **deletes each reminder once delivered**.

## Conventions

- **`{ data, error }`** response envelope everywhere; hooks throw on `error`.
- **No `any`**, strict TypeScript, ES5-safe iteration (`Array.from()` over
  iterators).
- **Dark mode only**; the accent color is themeable via CSS variables.
- New features follow the existing shape: a route under `app/api/<x>/`, a typed
  hook in `hooks/use<X>.ts`, and a page under `app/dashboard/<x>/`.
