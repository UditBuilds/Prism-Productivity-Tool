# PRISM — Claude Code Project Memory

## What This App Is
Personal productivity app with AI-native spaced repetition.
An LLM (Groq / Llama 3.3) reads notes and auto-generates flashcards.
Two users (you + a collaborator). Everything private by default.

## Tech Stack
- Next.js 14 App Router + TypeScript
- Supabase (Auth + Postgres)
- Tailwind CSS + shadcn/ui
- Groq (Llama 3.3 70B) for AI features
- React Query + Zustand

## Build Sessions
- Session 1: Foundation, auth, tasks module ✅ COMPLETE
- Session 2: Notes (markdown editor) + Plans ✅ COMPLETE
- Session 3: Reminders module ✅ COMPLETE
- Session 4: SRS engine (SM-2) + flashcard review UI ✅ COMPLETE
- Session 5: Gemini integration — auto-generate flashcards from notes ✅ COMPLETE
- Session 6: Learning curve dashboard + polish + deploy prep ✅ COMPLETE
- Session 7: PWA — installable on iOS + Android ✅ COMPLETE
- Session 8: Web Push notifications (fire while app closed) ✅ COMPLETE & VERIFIED
- Session 9: PDF → flashcards (pdf-parse + Groq) ✅ COMPLETE
- Session 10: Focus timer, countdowns, quote of day, mobile UX ✅ COMPLETE
- 🎉 Shipped. See DEPLOYMENT.md for deploy + cron setup.

## Design Rules
- Dark mode default, accent color #7C3AED (violet)
- Mobile responsive at 375px minimum
- Every list: loading skeleton + empty state + error state
- No `any` TypeScript types

## Key Files
- lib/srs/sm2.ts — SM-2 algorithm
- lib/ai/client.ts — Groq wrapper (flashcard generation)
- types/database.ts — all DB types
- store/ui.store.ts — modal/UI state

## Database
All tables have RLS enabled. user_id on every table.
Full schema committed at supabase/schema.sql. Email confirmation is OFF
(signup returns a session immediately → redirect straight to /dashboard).

## Conventions & Gotchas (Session 1)
- Pinned stack: Next 14 + Tailwind v3 + shadcn CLI v2 (Radix) + react-day-picker v9.
  Do NOT upgrade to shadcn v3 / Tailwind v4 — components are Radix + HSL-var based.
- Theme tokens: brand violet #7C3AED is mapped to BOTH `primary` and `accent`.
  Extras: bg-surface / bg-surface-raised / border-border / text-muted-foreground /
  success / warning / danger. Use `text-foreground` & `text-muted-foreground` for text.
- Dashboard is a REAL segment: app/dashboard/** (NOT a route group). (auth) IS a group.
- All times anchored to Asia/Kolkata — use helpers in lib/date.ts, never raw new Date() days.
- API pattern: every route checks auth first (401), returns { data, error }. See app/api/tasks.
- Server state via React Query hooks (hooks/*). UI-only state via Zustand (store/ui.store.ts).
- Shared task badge styles: components/tasks/task-styles.ts (reused by dashboard home).
- OneDrive can corrupt the .next cache (EINVAL readlink) — `rm -rf .next` and rebuild if so.
- lib/srs/sm2.ts (SM-2) and lib/ai/client.ts (Groq) are wired in as of Sessions 4 & 5.

## Conventions & Gotchas (Session 2)
- Markdown: NO library (respects pinned stack). lib/markdown.ts has renderMarkdown
  (escapes HTML first, then transforms — safe to dangerouslySetInnerHTML for own notes)
  and markdownExcerpt (plain-text card previews). Unit-tested via node.
- Notes editor uses a Write/Preview Tabs pair inside the modal; textarea is font-mono.
- Single source for plans list: hooks/usePlans.ts usePlansQuery (key ["plans"], full rows).
  TaskForm now consumes it too — do NOT re-add a separate ["plans"] query with a narrower
  select, or the shared cache shape will conflict.
- Plan progress = done/total of tasks with matching plan_id (computed in plans/page.tsx
  from useTasksQuery). Deleting a plan unlinks tasks (FK on delete set null) → useDeletePlan
  also invalidates ["tasks"].

## Conventions & Gotchas (Session 3 — Reminders)
- lib/date.ts: istDateTimeToIso(date, "HH:MM") builds an IST-anchored instant from the
  form's Calendar date + time input; formatReminderTime(iso) → {label,tone} (overdue/today/
  future). istDayNumber(ms) is the exported IST day index (also used by SRS streak).
- reminders has NO updated_at column — PATCH must not set it.
- NotificationChecker (mounted once in dashboard/layout) polls ["reminders"] every 60s,
  fires browser Notification + toast for due cards, marks is_sent. firedRef guards double-fire.
- TopBar bell dot + dashboard "Reminders Today" stat read pending reminders.

## Conventions & Gotchas (Session 4 — SRS)
- calculateSM2(quality, repetitions, easeFactor, interval) — rating IS the quality (0|2|4|5).
  Min interval is 1 day even for lapses; RatingButtons shows "<1 min" for Again to signal the
  in-session requeue (Review again re-queues cards rated Again/Hard locally; their DB
  next_review is still +1 day per SM-2).
- Single SRS cache: hooks/useSRS.ts key ["srs-cards"] = all cards; useDueCards/useDeckStats
  derive via `select` (no extra fetch). useSubmitReview invalidates ["srs-cards"] (server runs SM-2).
- Review flow snapshots due cards into Zustand (startSession) so mid-session refetches don't
  mutate the deck. Session/flip state lives in store/ui.store.ts; resetSession on unmount —
  the unmount cleanup MUST also clear the started-guard ref, else React Strict Mode's
  mount→cleanup→remount empties the session and the page shows "Nothing due!".
- Streak computed server-side in learn/page.tsx from srs_reviews (grace day: yesterday still
  anchors if nothing reviewed today yet). Learn page = server (streak) wrapping LearnClient.
- Flip is pure CSS (.card-scene/.card-3d/.card-face in globals.css). Flashcard content uses
  font-mono (JetBrains Mono) and renders markdown only when it detects md syntax.
- review/page.tsx wraps useSearchParams in <Suspense> (required for the client route build).

## Conventions & Gotchas (Session 5 — AI flashcards / Groq)
- Provider is Groq (model llama-3.3-70b-versatile) via groq-sdk — switched from Gemini because
  the Gemini key's project had free tier disabled (limit:0). Swap is isolated to lib/ai/client.ts;
  the route/modal/hooks are provider-agnostic.
- generateFlashcardsFromNote(title, content) in lib/ai/client.ts is SERVER-ONLY (touches
  GROQ_API_KEY, no NEXT_PUBLIC). Only call it from /api/srs/generate — never a client component.
- /api/srs/generate returns draft cards but does NOT persist. Saving is a separate confirm step:
  GenerateCardsModal bulk-POSTs the (edited) array to /api/srs/cards.
- /api/srs/cards POST is overloaded: array body → bulk insert (Gemini save); object body → single
  card. Both share toCardRow() validation.
- Error mapping in generate route: "Note is too short…" → 400 with the real message; any other
  Gemini/parse failure → generic 500 "Failed to generate cards. Try again."
- GenerateCardsModal phases: idle→generating→preview→saving (close on done). Generation errors
  return to idle; SAVE errors stay on preview so the drafts aren't lost.
- useGenerateCards has no toast (modal shows inline errors); useSaveGeneratedCards toasts
  "X cards added to <deck> deck" and invalidates ["srs-cards"].
- DeckStat.noteId = dominant source note (majority of a deck's cards share it) → DeckCard shows
  a "From: <note title>" chip (title resolved via useNotesQuery in LearnClient).
- tsconfig has no `target` (defaults to ES5 iteration) — don't `for…of` over Map/Set iterators;
  wrap in Array.from() first.

## Conventions & Gotchas (Session 6 — Analytics, polish, deploy)
- Learn page is a Decks/Analytics tabbed layout (shadcn Tabs, default "Decks"). AnalyticsPanel
  (recharts BarChart) is client-only; recharts pushes /dashboard/learn First Load to ~257 kB —
  candidate for next/dynamic lazy-load if it matters.
- /api/srs/analytics (key ["srs-analytics"], useAnalytics 5-min stale) computes totalReviews,
  mastered (ease≥2.5 & reps≥3), needWork (ease<1.8 OR reps=0 with last_reviewed), 30-day IST
  activity (gaps filled 0), and per-deck avgEase/masteryPct — all in JS over 3 queries.
- Chart X-axis dates are IST civil days as "YYYY-MM-DD" (new Date(dayIdx*DAY).toISOString());
  format with the manual MONTHS helper, NOT date-fns(new Date(str)) which tz-shifts the day.
- Per-page <title> via tiny segment layout.tsx files (client pages can't export metadata);
  server pages (dashboard home) export metadata directly. Root layout title is "PRISM".
- ReactQueryDevtools is gated behind NODE_ENV === "development" in app/providers.tsx.
- recharts Tooltip formatter: don't annotate the value param as number (type is ValueType|undefined)
  — stringify it instead.
- Deploy steps live in DEPLOYMENT.md. CRITICAL post-deploy step: set Supabase Auth Site URL +
  Redirect URLs (`<vercel-url>/**`) or auth redirects fail on the live domain.

## Conventions & Gotchas (Session 7 — PWA)
- @ducanh2912/next-pwa wraps next.config.mjs. `fallbacks` is TOP-LEVEL (not inside
  workboxOptions); offline fallback document is /offline. SW is production-only
  (disable: NODE_ENV === development) — won't appear on localhost dev.
- Generated workers are gitignored: sw.js, workbox-*, worker-*, swe-worker-*, fallback-*.
- Icons (8 sizes) generated by scripts/generate-icons.js (canvas, installed with --no-save so
  it's NOT in package.json — `npm i canvas` to regenerate). manifest.json + iOS meta via the
  Metadata/Viewport API in app/layout.tsx (NOT raw <head> tags).
- InstallPrompt (mounted in dashboard/layout) is mobile-only (md:hidden): Android uses
  beforeinstallprompt; iOS shows manual Add-to-Home-Screen hint. Dismissal in localStorage.

## Conventions & Gotchas (Session 8 — Web Push)
- VAPID env: NEXT_PUBLIC_VAPID_PUBLIC_KEY (client), VAPID_PRIVATE_KEY + VAPID_SUBJECT (server),
  CRON_SECRET guards /api/push/due. push_subscriptions table in schema.sql (RLS own-row).
- Custom SW: worker/index.ts (next-pwa customWorkerSrc: "worker") handles push + notificationclick.
  EXCLUDED from tsconfig (its `declare const self` clashes with DOM lib under tsc; next-pwa
  compiles it separately with webworker lib).
- /api/push/due is cron-triggered (x-cron-secret header), uses the SERVICE-ROLE admin client
  (lib/supabase/admin.ts) to read all users' due reminders, sends via web-push, marks is_sent,
  and prunes subscriptions on 404/410. Schedule it via pg_cron→pg_net (see DEPLOYMENT.md).
- iOS: Notification.requestPermission() ONLY works on a user gesture — never auto-request on
  mount. NotificationChecker just subscribes if already granted; the Settings "Enable
  Notifications" button is the gesture entry point. iOS push needs the INSTALLED PWA (16.4+).
- usePushSubscription.subscribe() returns { success, error }; syncSubscription throws on a
  non-OK /api/push/subscribe response so silent DB-save failures surface. SW-ready has a 10s
  race-timeout. Byte helpers use loops (ES5 target) and an explicit ArrayBuffer for the
  applicationServerKey type.

## Conventions & Gotchas (Session 10 — Focus, countdowns, quotes)
- Focus timer state lives in store/focus.store.ts (Zustand). The 1-second ticker +
  completion side effects (notification, PATCH completed, toast) live in
  components/focus/FloatingTimer.tsx, which is ALWAYS mounted in dashboard/layout —
  so the timer survives navigation. The focus page only renders state; never add a
  second interval.
- focus_sessions row is created on start (POST /api/focus) and the id stored via
  setSessionId; ended via PATCH {completed}. Timer starts instantly, DB id attaches async.
- Categories/durations in components/focus/categories.ts (static activeClass strings
  for Tailwind JIT).
- countdowns: target_date is a civil DATE ("YYYY-MM-DD"). Day math via lib/date.ts
  daysUntilIst/formatCountdown/countdownProgressPct (IST day indexes — never new Date(str)
  comparisons). Management UI = "Countdowns" tab on the Reminders page; dashboard
  "Upcoming" widget server-fetches the next 3.
- Quote of the day: lib/quotes.ts (exactly 100 entries, day-of-year rotation) +
  components/dashboard/QuoteCard.tsx (client, tap-to-expand) above the greeting.
- Mobile nav now shows Dashboard/Tasks/Notes/Focus/Learn — Settings moved out
  (reachable via TopBar avatar dropdown), alongside Plans/Reminders.
- TaskCard supports swipe gestures (touch only): right = mark done, left = delete with
  a 5s Undo toast (setTimeout cancelled by the toast button). Horizontal-intent lock +
  touch-action: pan-y keeps vertical scrolling intact.
