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
- Session 3: Reminders + To-do lists ← NEXT
- Session 4: SRS engine (SM-2) + flashcard review UI
- Session 5: Gemini integration — auto-generate flashcards from notes
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
