# PRISM — Claude Code Project Memory

## What This App Is
Personal productivity app with AI-native spaced repetition.
Gemini reads notes and auto-generates flashcards.
Two users (Udit + Drishti). Everything private by default.

## Tech Stack
- Next.js 14 App Router + TypeScript
- Supabase (Auth + Postgres)
- Tailwind CSS + shadcn/ui
- Gemini 1.5 Flash for AI features
- React Query + Zustand

## Build Sessions
- Session 1: Foundation, auth, tasks module ✅ COMPLETE
- Session 2: Notes (markdown editor) + Plans ✅ COMPLETE
- Session 3: Reminders module ✅ COMPLETE
- Session 4: SRS engine (SM-2) + flashcard review UI ✅ COMPLETE
- Session 5: Gemini integration — auto-generate flashcards from notes ← NEXT
- Session 6: Learning curve dashboard + polish

## Design Rules
- Dark mode default, accent color #7C3AED (violet)
- Mobile responsive at 375px minimum
- Every list: loading skeleton + empty state + error state
- No `any` TypeScript types

## Key Files
- lib/srs/sm2.ts — SM-2 algorithm
- lib/gemini/client.ts — Gemini wrapper
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
- lib/srs/sm2.ts (SM-2, ready for Session 4) and lib/gemini/client.ts (gemini-1.5-flash,
  ready for Session 5) are scaffolded but not yet wired in.

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
