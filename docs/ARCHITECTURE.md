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
   Supabase Postgres   Groq (GPT-OSS)     Supadata (transcripts)
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
  cookie-bound), and an admin (service-role) client that bypasses RLS. The
  admin client is confined to server routes with no user session to scope by,
  or with a table no user may read: the two cron endpoints (`/api/push/due`,
  `/api/cron/recurring-tasks`), the tiny-wins push, invite-code redemption in
  `/api/signup`, and the single `push_health` read in `/api/push/health`.
- **PostgREST caps every response at 1,000 rows, silently** — `200 OK`, no
  error, `data` cut short, and `.limit(5000)` is capped the same way. Any list
  read that can outgrow that goes through `selectAllRows()`
  (`lib/supabase/select-all.ts`), which returns the query unchanged when it
  fits in one page and pages with a unique tiebreaker when it does not.

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
`lib/ai/client.ts` (server-only) sends note content to **Groq / GPT-OSS 120B** (`openai/gpt-oss-120b`),
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

## Learning: why its reads are POST
Every `/api/learning/*` route is a POST, reads included. The production service
worker uses next-pwa's default `runtimeCaching` (`next.config.mjs` does not
override it), which caches every same-origin **GET** under `/api/` for 24 hours,
NetworkFirst, and answers from that cache when the network fails or is slower
than 10 seconds. Learning is online-only: offline it must say so rather than show
an old topic list as current. The rule matches GET only, so a POST read is never
cached and simply fails offline, and the screen shows its offline message. New
GET URLs would also crowd the 16-entry cache the other screens' offline copies
use. The service worker is off under `npm run dev`, so this only shows on a
production build. (`lib/learning/reads.ts` carries the same note.)

## Spaced repetition

`lib/srs/sm2.ts` is a hand-written **SM-2** implementation. Reviews record a
grade (Again/Hard/Good/Easy); the algorithm updates ease factor, repetition
count, and interval. The **streak** is one pure function,
`lib/srs/streak.ts`, called by both the Learn page and `/api/srs/analytics`. It
works from review dates and today's IST date alone and writes nothing: a missed
day is covered by a **freeze** when the day before it has a review, up to three
covered days per Monday–Sunday week (first three in date order). So a single
missed day is covered while its week has a freeze left, and two missed days in
a row always break the streak. "Freezes left" and the "Streak protected" notice
are derived from the same function.

## Notifications

- **In-app**: a poller fires the browser Notification API for due reminders.
- **Background**: a custom service worker (`worker/index.ts`) handles Web Push.
  `pg_cron` calls `/api/push/due` every minute with a `CRON_SECRET` header; the
  endpoint uses the admin client to find due reminders, sends pushes via VAPID,
  prunes dead subscriptions, and marks each reminder `is_sent = true` on
  successful delivery.

## Conventions

- **`{ data, error }`** response envelope everywhere, defined once in
  `lib/api/envelope.ts`: routes send it with `json()` (`lib/api/response.ts`),
  hooks unwrap it with `apiFetch()` (`lib/api/client.ts`), which throws on any
  non-OK status, a non-null `error`, or a null `data`.
- **TypeScript strict mode** with three documented `as any` escapes (each with
  an eslint-disable comment) for the service-role-only tables
  `push_delivery_log` and `push_health`, which are intentionally absent from
  `types/database.ts`. ES5-safe iteration (`Array.from()` over iterators).
- **Light and dark mode, dark by default.** Settings → Appearance offers
  System, Light and Dark per device (`localStorage` `prism-color-mode`). Light
  tokens live under `:root` in `app/globals.css`, dark under `.dark`; a script
  in `app/layout.tsx` sets the mode before first paint (`lib/color-mode.ts`).
  The accent color is themeable via CSS variables in both modes. Target values:
  `DESIGN.md`.
- New features follow the existing shape: a route under `app/api/<x>/`, a typed
  hook in `hooks/use<X>.ts`, and a page under `app/dashboard/<x>/`.
- **Tests** are plain Node scripts, `scripts/test-*.mjs`, that compile the pure
  modules they cover with the project's own `tsc` — no test runner. `npm test`
  runs all of them and CI runs `npm test` on every push and PR.
