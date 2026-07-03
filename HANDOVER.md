# PRISM — Session Handover

_Handover for continuing in a fresh Claude Code session. Written 2026-06-28._

---

## 0. TL;DR

- **Repo:** `C:\dev\prism` (git, branch `master`, remote `UditBuilds/Prism-Productivity-Tool`).
- **HEAD:** `5df8c27`, **working tree clean, all work pushed.** Nothing pending.
- This chat shipped **two big feature areas** (recurring daily tasks, focus-timer overhaul) plus several smaller fixes, and finished by **closing schema drift** (`supabase/schema.sql` now matches the live DB).
- **Read `CLAUDE.md` first** every session — it holds the canonical conventions. This file is a session-specific supplement.

---

## 1. Environment & workflow (important — non-obvious)

- **Two copies of the project exist.** The tool working directory is `C:\Users\uditk\OneDrive\Desktop\Prism-Productivity Tool` (a STALE June-4 copy with a `prism/` subfolder). **The real, active project is `C:\dev\prism`.** Always `cd /c/dev/prism` for git/build, and use absolute `C:\dev\prism\...` paths for file reads/edits. Glob/Grep need `path: "C:\dev\prism"` explicitly.
- **OneDrive is NOT involved** for `/c/dev/prism` (the OneDrive `.next` corruption gotcha in CLAUDE.md applies only to the Desktop copy).
- **Verification gauntlet** (run after any TS/TSX change, from `/c/dev/prism`):
  ```
  npx tsc --noEmit
  npx next lint
  npx next build
  ```
  All three must pass. Build should show `✓ Compiled successfully` and a page count (currently **47/47**). A one-off `⚠ Compiled with warnings` right after adding an npm dep is a transient next-pwa/cache artifact — re-run; it clears.
- **`.sql`-only changes** (e.g. `supabase/schema.sql`) are NOT in the Next build graph — tsc/lint/build can't validate them. Verify those by reading the edited region back.
- **Commits:** only when the user explicitly asks (they usually paste the exact `git add … / git commit -m … / git push`). Work proceeds directly on `master` (solo project; established cadence). Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```
- **`LF will be replaced by CRLF` warnings on `git add` are normal** on this Windows checkout — ignore them.
- **Read-only DB access** (no psql/supabase CLI, no Postgres connection string — only REST creds in `.env.local`): query via PostgREST with the service-role key (GET = read-only, bypasses RLS). Pattern used this session:
  ```bash
  URL=$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
  KEY=$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
  # rows:    curl -s "$URL/rest/v1/<table>?select=*&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
  # columns: curl -s "$URL/rest/v1/" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"   # OpenAPI: .definitions.<table>
  ```
  Never print the service-role key.

---

## 2. What shipped this session (newest → oldest, with commit hashes)

| Commit | What |
|---|---|
| `5df8c27` | **Schema sync** — added `recurring_tasks.days_of_week` + the whole `focus_categories` table & RLS to `supabase/schema.sql` (was stale). |
| `3b18a3f` | **Task list sort** — replaced the priority/recency comparator with a simple partition: active tasks first (in the API's due-date order), completed sunk to the bottom. |
| `201aefe` | **Due-date label** — `formatDueDate` now shows a literal IST date ("Jun 28") for `diff > 1` instead of "in N days"; "Today"/"Tomorrow"/"N days overdue" unchanged. |
| `c835b44` | **Real shadcn Switch** — replaced the hand-rolled "Repeat daily" toggle with `components/ui/switch.tsx` (Radix), themed to the app palette. |
| `5af83b0` | Fix: OFF-state toggle track had near-invisible contrast (added `border-border`). _(Superseded by the shadcn switch above, but the contrast lesson carried into switch.tsx theming.)_ |
| `cd97e20` | **Bug fix** — deleting a recurring task instance now ALSO deactivates its template (`is_active=false`) so the cron stops re-spawning. (Root cause: DELETE only removed the `tasks` row.) |
| `8129f3b` | 7-day sparkline (inline SVG, server-rendered) on the "Done This Week" KPI card. |
| `235328d` | YouTube → Notes import (modal + `/api/youtube/notes` + `generateNotesFromTranscript`). |
| `d00b585` | Perf: memoized Sidebar nav items (`NavItem` + `React.memo`). |
| `4fb5a2c` | Clearer toast when a recurring task's first instance is deferred to a future day. |
| `e4eacb4` | Day-pattern picker (Every day / Weekdays / Weekends / Custom) for recurring tasks. |
| `610d7a0` | Weekday-aware recurring spawning (`days_of_week`) + extracted shared `istWeekday()`. |
| `8e1aea2` | Merged upcoming reminders into the dashboard "Upcoming" section alongside countdowns. |
| `6e0ff79` | Open-ended **stopwatch** focus-timer mode (Pomodoro/Stopwatch toggle). |
| `eb875e7` | Analytics fix: credit partial **elapsed** time (not zero) for incomplete focus sessions. |
| `3ea499a` | Elapsed-seconds tracking + 20s heartbeat save for focus sessions. |
| `b18b8c5` | Focus category create/rename/delete + 12-color picker UI (`ManageCategoriesModal`). |
| `c509a0d` | Custom focus categories — API/hook/auto-seed + migrated consumers off the static list. |
| `7ce8ba3` | Sound (Web Audio chime) + toast + notification on focus-timer completion. |
| `9bfc7d9` | Recurring daily tasks UI — toggle, indicator icon, "Stop repeating" action. |
| `3496528` | Recurring task cron — daily spawn logic (`/api/cron/recurring-tasks`). |

---

## 3. Feature deep-dives (state of the two big areas)

### A. Recurring daily tasks — COMPLETE
- **Tables:** `recurring_tasks` (id, user_id, title, priority, is_active, created_at, **days_of_week int[]**) + `tasks.recurring_task_id` FK + unique partial index `(recurring_task_id, due_date) WHERE recurring_task_id IS NOT NULL`. All now in both `types/database.ts` and `supabase/schema.sql`.
- **Cron:** `app/api/cron/recurring-tasks/route.ts` (POST, `x-cron-secret` guard). Spawns one task/template/day for active templates whose `days_of_week` includes today's IST weekday; idempotent via the existence check + unique index.
  - **Convention:** weekday is `0=Sun … 6=Sat` via `istWeekday()` in `lib/date.ts`. The TaskForm picker uses the SAME convention (browser `getDay()`), and the POST validates server-side via `istWeekday()`.
  - **Scheduling:** documented in `docs/DEPLOYMENT.md` §4a as a pg_cron job `prism-recurring-tasks` at `35 18 * * *` UTC (= 00:05 IST). **⚠ Verify this is actually scheduled in the Supabase SQL editor for production** — the doc describes it; it may not be live.
  - Manual test: `curl -X POST http://localhost:3000/api/cron/recurring-tasks -H "x-cron-secret: $(grep '^CRON_SECRET=' .env.local | cut -d= -f2-)"`
- **Create flow** (`app/api/tasks/route.ts` POST): when `repeat_daily` is true, creates the template (with `days_of_week`) then conditionally spawns today's instance only if today is a selected weekday; otherwise returns `{ id, instanceCreatedToday:false }` so the form can show "first task on <Day>".
- **Stop/delete:** "Stop repeating" (TaskCard ··· menu → PATCH `stop_recurring`) deactivates the template but keeps instances. **Delete now ALSO deactivates the template** (shared `deactivateRecurringTemplate` helper) — deactivate first, then delete the row (`cd97e20`).
- **⚠ Pre-existing live data:** templates created before `cd97e20` may still be `is_active=true` and will keep spawning until their next instance is deleted via the (now-fixed) UI, or deactivated manually. (E.g. an "Hshsh" template `2ec770cf-…` was investigated; the user may want to deactivate stale templates directly.)

### B. Focus timer — COMPLETE
- **Custom categories:** `focus_categories` table (id, user_id, name, color hex, sort_order, created_at) + `/api/focus/categories` (GET/POST/PATCH/DELETE) + `hooks/useFocusCategories.ts` (auto-seeds the 5 legacy defaults on first empty fetch). `ManageCategoriesModal` + inline color picker (`components/focus/category-colors.ts`, 12 colors). `components/focus/categories.ts` is kept ONLY as the seed source + `categoryChartColor` fallback — consumers (FloatingTimer, focus page, ProductivityPanel, weekly review) read the live hook now.
- **Elapsed tracking:** `focus_sessions.elapsed_seconds` (nullable int). Store increments it on the same pause-gated tick as `timeLeft`; FloatingTimer saves a heartbeat every 20s and the final value on stop/complete. Analytics (`productivity`, `weekly`, `tinywin`) credit `elapsed_seconds/60` when present, else `duration_minutes` for completed, else 0 — so partial/stopped sessions count their real time.
- **Stopwatch mode:** `timerType: 'preset' | 'stopwatch'` in the store (distinct from `mode: 'focus'|'break'`). Stopwatch counts up, never auto-completes; manual stop = completion (sets `completed:true`, writes `duration_minutes = round(elapsed/60)`, fires the same chime/toast/notification).
- **Completion feedback:** `fireFocusCompletionFeedback()` exported from `FloatingTimer.tsx` (Web Audio chime + toast + hidden-tab notification).

### C. Smaller items (all done)
- Dashboard "Upcoming" merges countdowns + upcoming reminders, chronologically, capped at 3.
- "Done This Week" KPI has a 7-day inline-SVG sparkline (server-rendered; **no Recharts** — see gotcha below).
- Sidebar nav items memoized.
- YouTube → Notes import.
- Task list sorts by due date (API order) with completed at the bottom; due-date labels show literal dates beyond tomorrow.

---

## 4. Architecture gotchas the next session MUST know

1. **The dashboard (`app/dashboard/page.tsx`) is a Server Component** (async, server Supabase, no `"use client"`). It fetches all data in one `Promise.all`. **Recharts is client-only** → it CANNOT render there; that's why the sparkline is hand-rolled inline SVG. To add a chart to the dashboard you'd need a separate `"use client"` child component (the page already does this for `MoodWidget`).
2. **Passing extra fields through the task hooks without editing `hooks/useTasks.ts`:** `useCreateTask`/`useUpdateTask` have fixed input types (`CreateTaskInput`/`UpdateTaskInput`). Extra fields (`repeat_daily`, `days_of_week`, `stop_recurring`, `elapsed_seconds`, `duration_minutes`) are passed by assigning the payload to a **variable first** (structural width-subtyping bypasses excess-property checks) — they serialize at runtime and the API reads them. `useTasks.ts` is frequently off-limits per task constraints.
3. **Locally-typed Supabase tables:** the cron route types `recurring_tasks` via a local `RecurringSchema` cast (`as unknown as SupabaseClient<…>`) because it predates the shared type. The tasks/focus routes use the shared `Database` type (both tables are now in `types/database.ts`). When typing a table not yet in `Database`, use a **`type` alias (not `interface`)** for the Row — interfaces don't satisfy supabase-js's `Record<string,unknown>` `GenericTable` constraint and resolve to `never`.
4. **IST everywhere:** all date logic goes through `lib/date.ts` (`istDateString`, `istDayContext`, `istWeekday`, `istDayNumber`, `formatDueDate`, `formatReminderTime`, `formatCountdown`). Never use raw local `Date` day math. Weekday convention is `0=Sun…6=Sat`.
5. **`react-hot-toast` "replace" idiom:** hook-level `onSuccess` toasts fire before `mutate`-level ones; to replace a generic toast use `toast.dismiss()` then the specific `toast.success(...)` at the call site (used for the deferred-recurring-task message).
6. **`lucide-react` has no `Youtube` icon** in this pinned version — the YouTube features use the `Play` icon. Check icon availability before importing.
7. **No shadcn `Switch` until this session** — now installed (`components/ui/switch.tsx`, themed: checked `bg-accent`, unchecked `bg-muted` + `border-border`, thumb `bg-white`). It's wrapped in a `<label htmlFor>` so the whole row toggles (a `<button>` is labelable).

---

## 5. Open / possible follow-ups (none blocking)

- **Schedule the `prism-recurring-tasks` pg_cron job** in Supabase if not already live (see §3A).
- **Deactivate stale active recurring templates** in live data if any were created before `cd97e20` and are unwanted (they keep spawning until their instance is deleted via the fixed UI).
- **`CLAUDE.md` is not updated** with this session's new conventions (its session log ends earlier). Consider adding gotchas from §4 if you want them canonical.
- `days_of_week` live column is **NOT NULL with no default** (rows were backfilled). `schema.sql` matches this. If you ever re-run schema from scratch on a table with existing rows, inserts must always supply `days_of_week` (the app always does).
- Minor accepted UX: creating a recurring task on a non-matching weekday shows a brief optimistic task that vanishes on refetch (the clearer toast mitigates it); the shadcn Switch's OFF state shifts the thumb ~1px vs ON (negligible).

---

## 6. Quick orientation pointers

- Tasks API: `app/api/tasks/route.ts` · Tasks UI: `components/tasks/TaskForm.tsx`, `TaskCard.tsx`, `app/dashboard/tasks/page.tsx`
- Recurring cron: `app/api/cron/recurring-tasks/route.ts`
- Focus: `store/focus.store.ts`, `components/focus/FloatingTimer.tsx`, `app/dashboard/focus/page.tsx`, `app/api/focus/route.ts`, `app/api/focus/categories/route.ts`, `hooks/useFocus.ts`, `hooks/useFocusCategories.ts`
- Analytics: `app/api/analytics/productivity/route.ts`, `app/api/review/weekly/route.ts`, `app/api/push/tinywin/route.ts`
- Dates: `lib/date.ts` · Types: `types/database.ts` · Schema: `supabase/schema.sql` · Deploy/cron docs: `docs/DEPLOYMENT.md`
