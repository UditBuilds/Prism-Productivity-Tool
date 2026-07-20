# Prism — React Query / Caching Audit

Generated July 4, 2026. Covers 14 query keys across 11 hook files, 23 mutations, and the derived-cache invalidation system.

---

## 1. QueryClient Configuration

**File:** `app/providers.tsx:11-22`

```
defaultOptions.queries:
  staleTime: 30_000 (30s)      ← global default
  refetchOnWindowFocus: false
  retry: 1
  gcTime: not set               ← falls back to TanStack default (5 minutes)
```

**No `persistQueryClient` implementation exists anywhere in the codebase.** There is no import of `@tanstack/react-query-persist-client`, no `persister` prop on `QueryClientProvider`, and no `PersistQueryClientProvider` wrapper. The PWA service worker exists (`worker/index.ts`) and caches the app shell, but API data is never persisted across sessions or offline.

**per-entity staleTime/gcTime overrides** (listed in §2) range from 30s (calendar) to 30min (reminders), always with `gcTime = 2 × staleTime` or longer.

---

## 2. Query Key Inventory

| # | Query Key | Hook(s) | staleTime | gcTime | Data |
|---|-----------|---------|-----------|--------|------|
| 1 | `["tasks"]` | `useTasksQuery` | 3min | 6min | `Task[]` |
| 2 | `["notes"]` | `useNotesQuery` | 10min | 20min | `Note[]` |
| 3 | `["plans"]` | `usePlansQuery` | 15min | 30min | `Plan[]` |
| 4 | `["reminders"]` | `useRemindersQuery`, `useUpcomingReminders` (via select) | 30min | 60min | `Reminder[]` |
| 5 | `["focus-sessions"]` | `useRecentFocusSessions` | 5min | 10min | `FocusSession[]` |
| 6 | `["focus-categories"]` | `useFocusCategories` | 10min | 30min | `FocusCategoryRow[]` |
| 7 | `["mood-logs"]` | `useMoodHistory`, `useTodaysMood` (via select) | 10min | 20min | `MoodLog[]` |
| 8 | `["srs-cards"]` | `useAllCards`, `useDueCards`, `useDeckStats` (via select) | 15min | 30min | `SrsCard[]` |
| 9 | `["srs-analytics"]` | `useAnalytics` | 10min | 20min | `AnalyticsData` |
| 10 | `["countdowns"]` | `useCountdownsQuery` | 15min | 30min | `Countdown[]` |
| 11 | `["calendar", month]` | `useCalendarMonth` | 1min | 2min | `CalendarMonthData` |
| 12 | `["productivity-analytics"]` | `useProductivityAnalytics` | 5min | 10min | `ProductivityData` |
| 13 | `["weekly-review", week]` | `useWeeklyReview` | 5min | 10min | `WeeklyReviewData` |
| 14 | `["push-subscriptions"]` | `usePushSubscription` | n/a | n/a | local state only |

**Key structure pattern:** All use flat string arrays (`["entity"]`), except calendar and weekly-review which use parameterized keys (`["calendar", month]`, `["weekly-review", week]`). Derived views (`useDueCards`, `useTodaysMood`, `useUpcomingReminders`) share the parent cache via `select` — no separate network requests.

**DataPrefetcher** (`components/layout/DataPrefetcher.tsx`) warms keys #1-#9 on dashboard mount. Calendar, weekly review, and productivity are excluded (param-dependent or lazy-loaded).

---

## 3. Calendar Invalidation Trace

The calendar query key is `["calendar", month]`. The derived-cache invalidation system (`lib/derived-caches.ts`) declares that `["calendar"]` prefix-invalidates all `["calendar", month]` queries when a `"tasks"` or `"reminders"` mutation fires.

### Mutation-by-mutation trace:

| Mutation | File:Line | Invalidation Call | Calendar Invalidated? |
|----------|-----------|-------------------|----------------------|
| `useCreateTask` | useTasks.ts:94-96 | `invalidateDerivedCaches(qc, "tasks")` | ✅ via derived-caches |
| `useUpdateTask` | useTasks.ts:122-125 | `invalidateDerivedCaches(qc, "tasks")` | ✅ |
| `useDeleteTask` | useTasks.ts:147-149 | `invalidateDerivedCaches(qc, "tasks")` | ✅ |
| `useCreateReminder` | useReminders.ts:117-119 | `invalidateDerivedCaches(qc, "reminders")` | ✅ |
| `useUpdateReminder` | useReminders.ts:147-149 | `invalidateDerivedCaches(qc, "reminders")` | ✅ |
| `useDeleteReminder` | useReminders.ts:174-176 | `invalidateDerivedCaches(qc, "reminders")` | ✅ |
| `useCreatePlan` | usePlans.ts:83 | `qc.invalidateQueries({ queryKey: PLANS_KEY })` only | ❌ MISSING |
| `useUpdatePlan` | usePlans.ts:108 | `qc.invalidateQueries({ queryKey: PLANS_KEY })` only | ❌ MISSING |
| `useDeletePlan` | usePlans.ts:131-133 | `qc.invalidateQueries({ queryKey: ["tasks"] })` | ✅ (via tasks invalidation chain) |

**Gap identified:** Plans with a `target_date` appear on the calendar. Creating or updating a plan does NOT invalidate the calendar cache. The only reason this hasn't surfaced as a visible bug is that plans currently don't render on the calendar page (the calendar API only queries `tasks` and `reminders`, not `plans`). If calendar support for plans is added later, this becomes a real gap.

### Indirect invalidation paths (task update → downstream effects):

| What happens | Chain | Result |
|-------------|-------|--------|
| Task status → "done" | `useUpdateTask` → `invalidateDerivedCaches(qc, "tasks")` → `["calendar"]` + `["productivity-analytics"]` + `["weekly-review"]` | ✅ Calendar dots update, analytics refresh |
| Task due_date changed | same chain | ✅ Calendar re-renders |
| Task linked to plan | `useUpdateTask` → tasks cache invalidated; plan progress computed from tasks cache on render | ✅ (plans page reads from tasks query, not a separate plan-progress cache) |
| Task completed on dashboard | `DueTodayRow` calls `useUpdateTask` which triggers full chain | ✅ |
| SRS card reviewed | `useSubmitReview` → `invalidateDerivedCaches(qc, "srs-review")` | ✅ Productivity/weekly-review refreshed |
| Focus session ended | `useEndFocusSession` → `invalidateDerivedCaches(qc, "focus")` | ✅ Productivity/weekly-review refreshed |
| Mood logged | `useLogMood` → `invalidateDerivedCaches(qc, "mood")` | ✅ Weekly review refreshed |

---

## 4. Cross-Cache Dependency Gaps

### 4a. Task → Plan progress (OK — no gap)
Plan progress is computed client-side in `app/dashboard/plans/page.tsx` from `useTasksQuery`, not from a separate plans cache. When a task is completed via `useUpdateTask`, the tasks cache is re-fetched, which re-triggers the plans page's progress calculation. No explicit plan invalidation needed. ✅

### 4b. Plan create/update → Calendar (GAP)
Plans have `target_date` but a plan mutation doesn't invalidate `["calendar"]`. Currently harmless because the calendar API (`app/api/calendar/route.ts`) only queries `tasks` and `reminders`, not `plans`. If you add plan dots to the calendar grid, add `invalidateDerivedCaches(qc, "tasks")` — or better, add a new `"plans"` activity source to `derived-caches.ts` mapping to `["calendar"]`. 🔴

### 4c. Countdowns → Dashboard "Upcoming" (OK — no gap)
Countdowns on the dashboard are fetched server-side via `Promise.all` in the Server Component, not from React Query. No invalidation needed. The reminders page uses `useCountdownsQuery` which self-invalidates on create/delete. ✅

### 4d. Notes → SRS cards (OK — no gap)
Generating cards from a note doesn't modify the note, so the notes cache doesn't need invalidation. The cards cache (`["srs-cards"]`) is invalidated by `useSaveGeneratedCards` and `useDeleteCard`. ✅

### 4e. Deleting a card → Analytics (OK)
`useDeleteCard.onSettled` (useSRS.ts:247-249) calls `invalidateDerivedCaches(qc, "srs-review")` which covers `["productivity-analytics"]`, `["weekly-review"]`, and `["srs-analytics"]`. ✅

### 4f. Dashboard stats (DUE TODAY, DONE THIS WEEK, etc.) (OK — Server Component)
The dashboard is a Server Component (`app/dashboard/page.tsx`) that fetches fresh data on every navigation. These stats don't live in React Query and don't need mutation-triggered invalidation. ✅

### 4g. plan_id FK on task after plan delete (OK)
`useDeletePlan.onSettled` (usePlans.ts:131-133) explicitly invalidates `["tasks"]` because deleting a plan sets `plan_id` to NULL on linked tasks. This is the only cross-entity invalidation outside the derived-caches system. ✅

### 4h. DataPrefetcher excludes calendar/productivity/weekly-review (OK — intentional)
`DataPrefetcher.tsx:24-26` explicitly excludes these because they're param-dependent or already lazy. Calendar fetches on the calendar page mount (per-month param), productivity is lazy-loaded via dynamic import, and weekly review fetches on the review page mount (per-week param). ✅

---

## 5. Persistence Requirements

### 5a. What `persistQueryClient` would preserve

If implemented, React Query's `persistQueryClient` (backed by `localStorage` or IndexedDB) would keep cached API data across browser sessions and make it available offline. Current state: **none of the 14 query caches persist across a page reload.**

### 5b. What SHOULD persist (offline-first PWA)

| Query | Persist? | Why |
|-------|----------|-----|
| `["tasks"]` | ✅ Yes | User's primary data. High offline value. |
| `["notes"]` | ✅ Yes | Long-lived content. Rarely changes without user action. |
| `["plans"]` | ✅ Yes | Similar to tasks — user-authored, low churn. |
| `["srs-cards"]` | ✅ Yes | Flashcards for offline review. High value. |
| `["focus-categories"]` | ✅ Yes | Effectively static after setup. |
| `["reminders"]` | ❌ No | Time-critical. Stale reminders are dangerous. |
| `["focus-sessions"]` | ❌ No | Only last 5 shown. Low offline value. |
| `["mood-logs"]` | ❌ No | Low value. Only today's mood matters. |
| `["countdowns"]` | ❌ No | Time-sensitive. Stale countdowns are misleading. |
| `["calendar", month]` | ❌ No | Date-dependent. Becomes stale after midnight. |
| `["productivity-analytics"]` | ❌ No | Server-computed aggregations. Must be fresh. |
| `["weekly-review", week]` | ❌ No | Same. |
| `["srs-analytics"]` | ❌ No | Same. |

**Recommended split:** persist 5 user-authored caches (tasks, notes, plans, srs-cards, focus-categories); keep the 7 derived/time-sensitive caches network-only.

### 5c. Implementation considerations

1. **Storage medium:** IndexedDB (via `idb-keyval` + `@tanstack/react-query-persist-client`'s built-in adapter) rather than `localStorage`. The SRS cards cache alone could approach localStorage's 5MB limit if decks grow large.

2. **maxAge:** Set `maxAge: 24 * 60 * 60 * 1000` (24h) on persisted caches. Data older than a day should be treated as stale and re-fetched on next online access.

3. **Dehydration filter:** Use a `persistQueryClient` option to only serialize whitelisted query keys (the 5 "persist ✅" keys above). Mutations should still run against stale persisted data while offline and queue for retry when back online (TanStack Query's `onlineManager` + `mutationCache` handle this natively).

4. **Offline indicator interaction:** The existing `OfflineBanner` component detects connectivity loss. Pair it with `onlineManager.setOnline()` so React Query knows when to switch between cached and network data.

5. **Service worker:** The current SW (PWA via `@ducanh2912/next-pwa`) caches the app shell and fallback page. API responses are NOT cached by the SW (they use `NetworkFirst` or `NetworkOnly`). With `persistQueryClient`, the SW's role stays limited to app-shell caching — React Query handles API data persistence via IndexedDB.

---

## Summary — What Needs Work

| # | Item | Severity | Notes |
|---|------|----------|-------|
| 1 | `persistQueryClient` — not implemented | 🔴 High | Core PWA promise (offline access) is broken. User can install the app but sees empty pages offline. 5 caches should persist. |
| 2 | Plan mutations don't invalidate calendar | 🟡 Medium | Plans with target_date aren't on the calendar yet, but will be. Add now, not later. |
| 3 | `gcTime` default is implicit | 🟢 Low | Global gcTime falls back to TanStack default (5min). Explicit `gcTime: 10 * 60 * 1000` at the QueryClient level would make intent clear. |
| 4 | No retry on offline mutations | 🟢 Low | TanStack Query pauses mutations while offline by default (good). But there's no visual indicator that a mutation is queued. |
