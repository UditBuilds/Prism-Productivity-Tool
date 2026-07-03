# Fable 5 — Prism Polish: Bug Fixes + UX Improvements

> Quick sprint to fix issues found during visual QA of the live dashboard. Execute in order.

**Repo:** C:\dev\prism
**Stack:** Next.js 14, React 18, TypeScript, Tailwind v3, shadcn v2
**Rules:** No package upgrades. `tsc --noEmit && next lint && next build` must pass.

---

## 1. ONBOARDING WIZARD RE-APPEARS BUG

**Symptom:** The 3-step WelcomeWizard keeps reappearing when navigating between pages, even after completing it.

**Fix:** `components/onboarding/WelcomeWizard.tsx`

Check the localStorage key. There are two possible issues:
1. The wizard checks state on every page navigation instead of once on mount
2. The localStorage key is being overwritten or not persisted

Fix by adding a `useRef` guard:
```tsx
const dismissedRef = useRef(false);

useEffect(() => {
  if (dismissedRef.current) return;
  if (localStorage.getItem("prism-onboarding-complete") === "1") {
    dismissedRef.current = true;
    return;
  }
  setOpen(true);
}, []);
```

And when the wizard completes or is dismissed, set both the ref AND localStorage:
```tsx
function handleComplete() {
  localStorage.setItem("prism-onboarding-complete", "1");
  dismissedRef.current = true;
  setOpen(false);
}
```

Also ensure the `ChangelogModal` has a similar guard — if the onboarding wizard JUST completed, don't immediately show the changelog.

---

## 2. NOTIFICATION PERMISSION NUDGE

**Symptom:** User has notifications disabled and never gets prompted except in Settings.

**Fix A:** `app/dashboard/page.tsx` — add a notification nudge banner on the dashboard when permission is not granted:

```tsx
// Add after the greeting, before MoodWidget
{typeof Notification !== "undefined" && Notification.permission === "default" && (
  <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-center gap-3">
    <Bell className="h-5 w-5 text-amber-400 shrink-0" />
    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium text-foreground">Enable notifications</p>
      <p className="text-xs text-muted-foreground">Get reminded about tasks and reviews on time.</p>
    </div>
    <Button size="sm" className="rounded-lg shrink-0" onClick={async () => {
      const result = await Notification.requestPermission();
      if (result === "granted") {
        // Re-fetch or re-render to hide this banner
        window.location.reload();
      }
    }}>
      Enable
    </Button>
  </div>
)}
```

Import `Bell` from lucide-react and `Button` from ui/button.

**Fix B:** `components/reminders/ReminderForm.tsx` — after saving, auto-trigger permission prompt if "default":

```tsx
// In handleSubmit, after createReminder.mutate():
if (typeof Notification !== "undefined" && Notification.permission === "default") {
  setTimeout(() => {
    toast((t) => (
      <div className="flex items-center gap-3">
        <span>🔔 Enable notifications to get alerted on time?</span>
        <button
          className="shrink-0 text-accent font-medium"
          onClick={async () => {
            await Notification.requestPermission();
            toast.dismiss(t.id);
          }}
        >
          Enable
        </button>
      </div>
    ), { duration: 8000 });
  }, 500);
}
```

---

## 3. FIX LEARN BADGE COUNT

**Symptom:** "Learn 9+" badge in sidebar but there are 75 due cards.

**Root cause:** `NavBadges` uses a different count source than what the Learn page shows.

**Fix:** `components/layout/NavBadges.tsx` — audit what query feeds the "learn" badge count. It should match the same `dueNow` count from the Learn page (cards where `next_review <= now`).

Read both `NavBadges.tsx` and `hooks/useSRS.ts` to find the mismatch, then fix the badge to show the actual due-now count. If the count > 99, show "99+" instead of potentially showing 9+ for 75.

---

## 4. FIX "GLAMSELF" TYPO

**Fix:** `app/dashboard/page.tsx` or wherever the task title "Work on Glamself" originates.

Search for "Glamself" across the codebase and fix it to "GlamShelf":
```
search: "Glamself" → replace with "GlamShelf"
```

The task was likely typed by the user in Supabase, so it might be a database value, not code. If it's in the DB, the fix is cosmetic only — update the dashboard rendering to NOT have a hardcoded title. If it's actual user data, leave it — this is just a data entry typo, not a code bug.

---

## 5. FOCUS TIMER COMPLETION NUDGE

**Symptom:** All focus sessions show "Stopped" not "Completed".

**Fix A:** `components/focus/FloatingTimer.tsx` — when the timer reaches 0, add a more satisfying completion animation:

```tsx
// Add confetti-like celebration particles (CSS-only)
// Already partially implemented — verify the completion chime + toast fires
```

**Fix B:** Add a subtle "Come back and finish!" message if a timer was stopped early:
The "Stopped" badge is fine — but add a motivational nudge in the recent sessions list when multiple sessions in a row are stopped:

```tsx
// In app/dashboard/focus/page.tsx, after the recent sessions list:
{recent && recent.length >= 3 && recent.slice(0, 3).every(s => !s.completed) && (
  <p className="mt-3 text-xs text-muted-foreground text-center">
    💡 Try completing one full session — it builds momentum.
  </p>
)}
```

---

## 6. HIDE TANSTACK DEVTOOLS IN PRODUCTION

**Fix:** `app/providers.tsx`

The ReactQueryDevtools should only render in development:
```tsx
{process.env.NODE_ENV === "development" && <ReactQueryDevtools />}
```

If `ReactQueryDevtools` is imported unconditionally, wrap it:
```tsx
// At top of file
const ReactQueryDevtoolsProduction = process.env.NODE_ENV === "production"
  ? () => null
  : dynamic(() => import("@tanstack/react-query-devtools").then(d => ({ default: d.ReactQueryDevtools })), { ssr: false });
```

Or simpler: check `process.env.NODE_ENV` before rendering.

---

## 7. PAGE TRANSITION POLISH

**Symptom:** `animate-fade-up` is on pages but sidebar stays static.

**Fix:** `app/dashboard/layout.tsx` — add a subtle coordinated animation:

```tsx
// Wrap main content in a keyed div that re-animates on route change:
<main key={pathname} className="animate-fade-up mx-auto max-w-6xl px-4 py-6 pb-[calc(6rem_+_env(safe-area-inset-bottom))] md:px-8 md:pb-10">
  {children}
</main>
```

But this requires `pathname` — dashboard layout is a Server Component. You'll need to either:
- Extract the `<main>` into a client component that reads `usePathname()`, OR
- Skip the key-based animation and rely on the existing `animate-fade-up` (which works per-page)

The simpler fix: just verify `animate-fade-up` is on every page's root div. I saw it working on login/signup — check dashboard, tasks, notes, plans, reminders, calendar, focus, learn, review, settings.

---

## 8. UPCOMING QUICK-ADD FROM DASHBOARD

**Symptom:** "Nothing coming up · Add countdown" — the quick-add experience is weak.

**Fix:** `app/dashboard/page.tsx` — add a one-click quick-add for countdowns:

```tsx
// Replace the empty state with a quick-add form:
{upcomingItems.length === 0 ? (
  <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center">
    <p className="text-sm text-muted-foreground mb-3">Nothing coming up</p>
    <div className="flex justify-center gap-2">
      <Link href="/dashboard/reminders" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">
        + Add countdown
      </Link>
      <Link href="/dashboard/tasks" className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-raised">
        + Add task
      </Link>
    </div>
  </div>
) : (...)}
```

---

## VERIFICATION

After all fixes:
```bash
cd C:\dev\prism
npx tsc --noEmit
npx next lint
npx next build
```

All three green. 0 errors, 0 warnings.

---

## ORDER

1. Onboarding re-appear bug (most annoying)
2. Notification nudge (highest impact)
3. Learn badge fix
4. Glamself typo check
5. Focus nudge
6. Tanstack devtools
7. Page transitions
8. Upcoming quick-add
