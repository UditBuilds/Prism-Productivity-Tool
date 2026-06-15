<div align="center">

# PRISM

### An AI-native personal productivity & learning system

**Capture your work, study with spaced repetition, and let AI turn your notes, PDFs, and YouTube videos into review-ready flashcards — automatically.**

![Next.js](https://img.shields.io/badge/Next.js_14-000000?style=flat&logo=next.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript_(strict)-3178C6?style=flat&logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=flat&logo=supabase&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL_·_RLS-4169E1?style=flat&logo=postgresql&logoColor=white)
![Groq](https://img.shields.io/badge/Groq_·_LLaMA_3.3_70B-F55036?style=flat&logo=meta&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white)
![React Query](https://img.shields.io/badge/React_Query-FF4154?style=flat&logo=reactquery&logoColor=white)
![PWA](https://img.shields.io/badge/PWA_·_Web_Push-5A0FC8?style=flat&logo=pwa&logoColor=white)

**Live:** private deployment on Vercel · **Self-host in ~15 minutes** → [Getting Started](#-getting-started)

</div>

---

## What is PRISM?

PRISM is a private, single-tenant productivity app that fuses day-to-day execution (tasks, notes, plans, reminders, calendar, focus timer) with a real **spaced-repetition learning engine** — and wires generative AI through the middle of it. Drop in a note, a PDF, or a YouTube URL and PRISM extracts the content, calls an LLM, and lands de-duplicated flashcards straight into an SM-2 review queue.

It is built for **two users** (the owner and one collaborator), which is a deliberate design constraint: every decision optimizes for **clarity, correctness, and privacy** over multi-tenant scale. The result is a focused product that demonstrates full-stack engineering depth — auth, RLS, background jobs, AI pipelines, offline PWA, and time-zone-correct analytics — without the noise of a SaaS starter template.

### Why it exists

Most productivity tools make you *manually* turn what you read into what you remember. PRISM closes that loop: the same notes you write to get work done become the spaced-repetition deck that makes the knowledge stick — with the busywork of authoring flashcards handed to an LLM.

---

## ✨ Highlights

- **Three AI ingestion pipelines** — generate flashcards from **notes**, **PDFs** (storage-backed, serverless-safe), and **YouTube transcripts**, all converging on one review queue.
- **A real SRS engine** — a hand-written **SM-2** implementation with a 4-grade review flow and an **auto-applied streak-freeze** system (3 freezes per week) that protects a learning streak through a single missed day.
- **Private by construction** — **Row-Level Security on every table**; every query is scoped to the authenticated user *at the database layer*, not just in app code.
- **Time-zone correct** — all date math is anchored to **Asia/Kolkata (IST)** through a single helper module, so streaks, "due today," weekly boundaries, and analytics never drift across midnight or server time zones.
- **Installable PWA with web push** — add to home screen on iOS/Android; a `pg_cron`-driven endpoint delivers reminder notifications **while the app is closed**.
- **Strict engineering bar** — TypeScript `strict` with **zero `any`**; `tsc` + `eslint` + `next build` (43 routes) are green on every change.

---

## Feature tour

> Every feature below is implemented in this repository — see the route/component it maps to.

### Productivity
- **Tasks** — priority & status, due dates, plan linking, a detail page, mobile swipe-to-complete/delete, and optimistic create/update/delete with rollback. Completion is tracked via a dedicated `completed_at` column.
- **Plans** — group tasks into a goal; progress bars compute from linked-task completion.
- **Notes** — a **custom markdown renderer** (no third-party markdown lib), tag chips with deterministic colors, full-text search, and a dual-mode modal: tap to **read** (formatted), one click to **edit** (write/preview).
- **Reminders** — scheduled notifications via the browser Notification API *and* web push; reminders **auto-delete once delivered**, so the list never clogs.
- **Calendar** — a **bespoke, IST-safe month grid** (not a date-picker override) showing tasks by due date and reminders by time, with a day-detail panel.
- **Focus timer** — categories & durations, a global floating timer that survives navigation, and a session history that feeds analytics.
- **Countdowns** & **daily mood check-ins**.

### Learning (Spaced Repetition)
- **SM-2 scheduling** with a flip-card review UI and a 4-grade flow (Again / Hard / Good / Easy) showing next-interval previews.
- **Decks** with rename, bulk delete, and per-card edit/delete.
- **Streak + freeze protection** — a freeze-aware streak that auto-spends one of three weekly freezes to cover a single-day gap, with the protection surfaced in-app.

### AI flashcard generation
- **From notes** — Groq · LLaMA 3.3 70B turns note content into self-contained Q&A cards.
- **From PDFs** — a **storage-backed pipeline**: the file uploads directly to a private Supabase Storage bucket (sidestepping the serverless request-body limit), the server extracts per-page text with `pdf-parse`, chunks it (quick / smart-sampled / page-range modes), runs sequential LLM calls, and merges with Jaccard near-duplicate detection. No OCR — scanned PDFs fail honestly with a typed error.
- **From YouTube** — captions are fetched from the **Supadata transcript API** (reliable from datacenter IPs, unlike scraping), cleaned, chunked, and sent through the same generation + merge stage.

### Insights
- **Learning analytics** — 30-day review activity, mastery counts, per-deck performance.
- **Productivity analytics** — focus / task / review trends, week-over-week comparison, peak hour & most-productive day.
- **Weekly review** — a day-by-day Mon–Sun digest with best/quietest day and deterministic insights.

### Platform
- **PWA** — installable, offline fallback, app-shell caching.
- **Web push** — VAPID keys, a service worker, and a cron-guarded delivery endpoint.
- **Dark-mode-only** design system with a themeable accent color and a mobile-first layout that holds at 375px.

---

## 🛠 Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | **Next.js 14** (App Router) · React 18 · TypeScript (strict) |
| Database & Auth | **Supabase** — Postgres, Row-Level Security, Storage, SSR auth |
| Styling | **Tailwind CSS v3** · shadcn/ui (Radix primitives) |
| Server state | **TanStack Query v5** (caching, optimistic updates, prefetch) |
| UI state | **Zustand v5** |
| AI | **Groq** — LLaMA 3.3 70B (flashcard generation) |
| Transcripts | **Supadata** transcript API (YouTube captions) |
| PDF | `pdf-parse` (per-page text extraction) |
| Charts | Recharts |
| Notifications | Web Push (VAPID) · `@ducanh2912/next-pwa` service worker |
| Dates | `date-fns` + a custom IST helper module |
| Deployment | Vercel · Supabase · `pg_cron` |

A deeper write-up of the design lives in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## 🏗 Architecture at a glance

```
Browser (PWA)
  │  React Query (server cache) + Zustand (UI state)
  ▼
Next.js App Router ── Route Handlers (/app/api/*)  ──▶  Supabase Postgres (RLS)
  │                         │                              Supabase Storage (PDFs)
  │                         ├──▶ Groq (LLaMA 3.3 70B)
  │                         └──▶ Supadata (YouTube transcripts)
  ▼
Service Worker ──▶ Web Push  ◀── pg_cron → POST /api/push/due (cron-secret guarded)
```

- **Security** — RLS policies (`auth.uid() = user_id`) on every table; the service-role key is used only by the server-side cron endpoint. See **[SECURITY.md](SECURITY.md)**.
- **State** — server data flows through React Query hooks (`hooks/*`); UI-only state lives in Zustand. Mutations invalidate a small map of *derived* read-models (calendar, analytics, weekly review) so dashboards stay coherent.
- **Time** — `lib/date.ts` is the single source of truth for IST math; raw `new Date()` day arithmetic is banned by convention.
- **AI ingestion** — large PDFs never pass through the API body; they're uploaded to Storage and processed by reference, keeping requests under the serverless limit.

---

## 📸 Screenshots

Screenshots live in **[`docs/screenshots/`](docs/screenshots/)**. A capture checklist (which screens, filenames, and sizing) is in **[docs/screenshots/README.md](docs/screenshots/README.md)** — drop the PNGs in and they render here.

| Dashboard | SRS review | AI flashcard generation |
|:--:|:--:|:--:|
| _add `dashboard.png`_ | _add `srs-review.png`_ | _add `ai-generation.png`_ |

---

## 🚀 Getting Started

### Prerequisites
- **Node.js 18+**
- A **Supabase** project (free at [supabase.com](https://supabase.com))
- A **Groq** API key (free at [console.groq.com](https://console.groq.com))
- *(optional, for YouTube → flashcards)* a **Supadata** API key ([supadata.ai](https://supadata.ai))

### 1. Clone & install
```bash
git clone https://github.com/UditBuilds/Prism-Productivity-Tool.git
cd Prism-Productivity-Tool
npm install
```

### 2. Configure environment
Copy the example and fill in your keys:
```bash
cp .env.local.example .env.local
```

| Variable | Required | Description |
|----------|:--:|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Service-role key (server only — keep secret) |
| `GROQ_API_KEY` | ✅ | Groq API key (AI flashcards) |
| `NEXT_PUBLIC_APP_URL` | ➖ | Deployed URL (password-reset redirects) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | ➖ | Web push (`npx web-push generate-vapid-keys`) |
| `CRON_SECRET` | ➖ | Shared secret guarding the push-cron endpoint |
| `SUPADATA_API_KEY` | ➖ | YouTube → flashcards |

### 3. Set up the database
Run **`supabase/schema.sql`** in the Supabase SQL editor (creates every table with RLS enabled and the signup trigger).

### 4. Run
```bash
npm run dev      # http://localhost:3000
```

Full local-dev notes (conventions, gotchas, verification gates) are in **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**, and a 15-minute production walkthrough is in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

---

## 📂 Project structure

```
app/                 Next.js App Router
├─ (auth)/           Login, signup, password reset
├─ dashboard/        Feature pages (tasks, notes, learn, calendar, focus, …)
└─ api/              22 route handlers (auth-guarded, { data, error } envelope)
components/          Feature UIs + shared shell + shadcn/ui primitives
hooks/               React Query data hooks (one cache key per domain)
lib/
├─ ai/               Groq client + prompts (server-only)
├─ pdf/              Extraction, chunking, dedup-merge pipeline
├─ youtube/          Transcript fetch + chunking
├─ srs/              SM-2 algorithm
├─ supabase/         Browser / server / admin clients
└─ date.ts           IST time helpers (single source of truth)
store/               Zustand UI stores
types/               Hand-authored Supabase types
worker/              Custom service-worker source (push handling)
supabase/schema.sql  Full schema (tables, RLS, triggers)
```

---

## 🔬 Engineering notes

- **No `any`, ever.** `tsconfig` has no `target`, so iteration over `Map`/`Set` is wrapped in `Array.from()` to stay ES5-safe.
- **Every API route** checks auth first, then returns a `{ data, error }` envelope; hooks unwrap and throw on `error`.
- **Quality gates** run on every change: `npm run typecheck` → `npm run lint` → `npm run build`.
- **Algorithms are unit-checked** via standalone Node scripts during development (SM-2, the markdown renderer, PDF chunk/merge, and the calendar's IST weekday math were each verified against references) — there is no CI test runner wired up yet (see Roadmap).

---

## 🗺 Roadmap

- [ ] Automated test suite + CI (the algorithm checks above, formalized)
- [ ] Background sweeper for orphaned temp PDF uploads
- [ ] Cross-cache invalidation on calendar from task/reminder mutations
- [ ] Anki / Notion import
- [ ] AI note summarization
- [ ] Deeper analytics history (beyond the 30-day window)

---

## 📄 License

[MIT](LICENSE) © Udit Kumar

<div align="center">
<sub>Built with Next.js · Supabase · Groq — engineered with Claude Code.</sub>
</div>
