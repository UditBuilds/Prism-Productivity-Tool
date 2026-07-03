# Fable 5 — Prism Bug Fixes + SaaS Polish Sprint (Deadline: Jul 7)

> Maximal output sprint. Fix the reminder bug, then push Prism from "personal tool" to "SaaS-quality product." Every section is a standalone task — execute in order.

**Repo:** C:\dev\prism
**Stack:** Next.js 14, React 18, TypeScript strict, Tailwind v3, shadcn v2, Supabase, React Query v5, Zustand v5
**Rules:** No package upgrades. No API/hook/lib/database changes unless specified. `tsc --noEmit && next lint && next build` must pass after every task.

---

## PHASE 1: CRITICAL BUG FIX — Reminders Don't Fire

### Bug: Reminder notifications never appear

**Root cause:** `app/api/reminders/route.ts` GET endpoint line 36 — `.gte("remind_at", now)` filters out reminders as soon as their time passes. When the React Query cache refetches (after 3-min staleTime), due reminders vanish from the cache before `NotificationChecker` can fire them.

**Fix — 2 files:**

**1a. `app/api/reminders/route.ts` — Remove the `.gte("remind_at", now)` filter**

Change the GET from:
```typescript
const now = new Date().toISOString();
const { data, error } = await supabase
    .from("reminders")
    .select("*")
    .gte("remind_at", now)   // ← REMOVE THIS LINE
    .order("remind_at", { ascending: true });
```
To:
```typescript
const { data, error } = await supabase
    .from("reminders")
    .select("*")
    .order("remind_at", { ascending: true });
```

Also update the comment at line 29-31 to: "Return all reminders. Past-due unsent reminders are included so the client-side NotificationChecker can fire them."

**1b. `hooks/useReminders.ts` — Increase staleTime to prevent premature refetch**

Change `staleTime: 3 * 60 * 1000` to `staleTime: 30 * 60 * 1000` (30 minutes). The cache shouldn't expire while the user might have due reminders pending. The `NotificationChecker` and mutations already handle invalidation correctly.

### 1c. Add notification permission prompt to ReminderForm

**File:** `components/reminders/ReminderForm.tsx`

After the user clicks "Save" on a new reminder, check `Notification.permission`:
- If `"default"` (never asked): show a toast "🔔 Enable notifications to get reminded on time?" with an "Enable" button that calls `Notification.requestPermission()`
- If `"denied"`: show a toast "Notifications are blocked. Enable them in browser settings to receive reminders."

Also add a small info text below the date/time pickers when permission is not granted:
```tsx
{typeof Notification !== "undefined" && Notification.permission !== "granted" && (
  <p className="text-xs text-muted-foreground">
    ⚠️ Notifications are not enabled. You'll only see reminders while Prism is open.
  </p>
)}
```

### 1d. Add notification permission status to Settings

**File:** `app/dashboard/settings/page.tsx` (or `components/settings/NotificationsCard.tsx`)

Show current notification permission status with a button:
- `"granted"` → green badge "Notifications enabled ✓" 
- `"default"` → amber badge "Notifications not set up" + "Enable" button
- `"denied"` → red badge "Notifications blocked" + "Open browser settings" link

---

## PHASE 2: SAAS ONBOARDING — First-Run Experience

### 2a. Welcome wizard after signup

**Create:** `components/onboarding/WelcomeWizard.tsx`

After a new user signs up and lands on `/dashboard`, show a 3-step modal overlay (only once, tracked via localStorage `prism-onboarding-complete`):

**Step 1 — "Welcome to Prism"**
- Animated PRISM logo
- "Your AI-native productivity system" tagline
- 3 bullet points: Tasks + Notes, SRS flashcards, Focus timer
- "Next" button (gradient)

**Step 2 — "Enable notifications"**
- Bell icon with pulse animation
- "Prism works best with notifications. Get reminded about tasks and reviews even when the tab is closed."
- "Enable notifications" button (calls `Notification.requestPermission()`)
- "Skip for now" secondary link

**Step 3 — "You're all set"**
- Checkmark animation
- "Start by adding a task or creating your first flashcard deck."
- "Go to dashboard" button (closes modal, sets localStorage flag)

### 2b. Wire the wizard

**Modify:** `app/dashboard/layout.tsx`

Add `<WelcomeWizard />` after the `<DataPrefetcher />` component. The wizard checks localStorage on mount — if `prism-onboarding-complete` is not set, it opens.

### 2c. First-run empty state improvements

**Modify:** `components/shared/EmptyStates.tsx`

Each empty state component gets a 1-line guided action instead of just "nothing here":
- Tasks: "Create your first task to start organizing your day" + a suggested first task chip ("Try: 'Review weekly goals'")
- Notes: "Write your first note — Prism can generate flashcards from it"
- Plans: "Create a plan to group related tasks and track progress"
- SRS: "Add your first flashcard or import from a note, PDF, or YouTube video"
- Focus: "Start your first focus session to track deep work"

---

## PHASE 3: ERROR HANDLING & RELIABILITY

### 3a. Global error boundary

**Create:** `components/ErrorBoundary.tsx`

```tsx
"use client";
import { Component, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };
  
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-danger/30 bg-danger/10">
            <AlertCircle className="h-6 w-6 text-danger" />
          </div>
          <p className="mt-4 text-sm font-medium text-foreground">Something went wrong</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {this.state.error?.message ?? "An unexpected error occurred"}
          </p>
          <Button variant="outline" className="mt-4 rounded-lg" onClick={() => this.setState({ hasError: false, error: null })}>
            <RefreshCw className="mr-1.5 h-4 w-4" /> Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

### 3b. Wrap critical pages with ErrorBoundary

**Modify:** `app/dashboard/layout.tsx` — wrap `{children}` in `<ErrorBoundary>`
**Modify:** `app/(auth)/layout.tsx` — wrap `{children}` in `<ErrorBoundary>`

### 3c. Add offline detection

**Create:** `components/OfflineBanner.tsx`

```tsx
"use client";
import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  
  useEffect(() => {
    const go = () => setOffline(!navigator.onLine);
    window.addEventListener("online", go);
    window.addEventListener("offline", go);
    return () => { window.removeEventListener("online", go); window.removeEventListener("offline", go); };
  }, []);

  if (!offline) return null;
  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-500/90 px-4 py-2 text-sm font-medium text-black">
      <WifiOff className="h-4 w-4" /> You're offline — changes won't sync until you reconnect
    </div>
  );
}
```

**Modify:** `app/dashboard/layout.tsx` — add `<OfflineBanner />` at the top of the layout, before the Sidebar.

---

## PHASE 4: KEYBOARD SHORTCUTS & ACCESSIBILITY

### 4a. Keyboard shortcuts modal

**Create:** `components/KeyboardShortcuts.tsx`

Press `?` anywhere in the dashboard to open a modal showing shortcuts:
```
?          — Show this help
Ctrl+K     — Quick search (future)
n          — New task
t          — Go to Tasks
l          — Go to Learn
f          — Go to Focus
d          — Go to Dashboard
Space      — Flip flashcard (in review)
1-4        — Grade flashcard (in review)
Escape     — Close modal / end session early
```

### 4b. Wire it

**Modify:** `app/dashboard/layout.tsx` — add `<KeyboardShortcuts />` after the children.

Implementation: use a `useEffect` with `keydown` listener. When `?` is pressed (and no input/textarea is focused), open a dialog. Track via Zustand or local state.

### 4c. Accessibility audit

- Ensure all interactive elements have accessible labels (buttons, links, inputs)
- Add `aria-label` to icon-only buttons (check Sidebar, TopBar, MobileNav)
- Ensure focus trapping in modals (shadcn Dialog already handles this — verify)
- Add `role="status"` to loading spinners for screen readers

---

## PHASE 5: UI POLISH & CONSISTENCY

### 5a. Toast consistency

Audit all toasts across the app. Standardize:
- Success: green checkmark + short message + no icon duplication
- Error: red X + error message from server
- Loading: spinner + "Saving..." / "Creating..."
- Use `toast.dismiss()` before new related toasts to prevent stacking

### 5b. Loading skeleton consistency

Every list that can load should have:
- Skeleton shimmer with violet tint (already done in UI primitives)
- Consistent number of skeleton items (3 for compact, 5 for full lists)
- Same height/width as the actual content

Check: tasks, notes, plans, reminders, calendar, learn, focus, review, settings.

### 5c. Page transition consistency

The `animate-fade-up` class exists in globals.css. Make sure every page's main content wrapper has it:
```tsx
<div className="animate-fade-up">...</div>
```

Check: all 10 dashboard pages + auth pages.

### 5d. Mobile drawer for TaskForm/ReminderForm/NoteModal

On mobile (< 768px), forms should slide up from the bottom as sheets instead of appearing as centered dialogs. The current Dialog component is centered — add a mobile-only class that transforms it to a bottom sheet:

```css
@media (max-width: 767px) {
  .dialog-bottom-sheet [data-slot="dialog-content"] {
    @apply fixed bottom-0 left-0 right-0 top-auto max-h-[85vh] rounded-b-none rounded-t-2xl;
  }
}
```

Apply `.dialog-bottom-sheet` to TaskForm, ReminderForm, NoteModal, CardForm dialogs.

---

## PHASE 6: WHAT'S NEW / CHANGELOG

### 6a. Changelog modal

**Create:** `components/ChangelogModal.tsx`

Shows on first visit after an update (tracked via localStorage `prism-changelog-version` matching the current version from `package.json`).

Modal content: last 5 changes with version numbers, animated list:
```
v0.2.0 — Fresh new design with gradients, glass-morphism, and animations
v0.1.9 — Improved notification reliability + onboarding wizard
v0.1.8 — Recurring daily tasks with custom day patterns
```

### 6b. Wire it

**Modify:** `app/dashboard/layout.tsx` — add `<ChangelogModal />` after the WelcomeWizard. Only show if onboarding is already complete (check localStorage).

---

## PHASE 7: PERFORMANCE & BUNDLE OPTIMIZATION

### 7a. Audit dynamic imports

Check that these are already lazy-loaded:
- `AnalyticsPanel` (SRS) — ✓ already dynamic
- `ProductivityPanel` — check if it's in the main bundle
- `Recharts` — ensure it's only imported in analytics panels (client-only)
- `Calendar` component from shadcn — verify it's not in the main dashboard bundle

### 7b. Font display optimization

**Modify:** `app/layout.tsx` — ensure the font link has `display=swap`:
If using next/font, verify `display: "swap"` is set on both Inter and JetBrains Mono.

### 7c. Image optimization

- Favicon: ensure `favicon.ico` is optimized (under 15KB)
- PWA icons: the icon set already exists at 72-512px — ensure they're proper PNGs
- No large images in the app (it's mostly text/icons — should be fine)

---

## PHASE 8: MOBILE POLISH

### 8a. Pull-to-refresh

Add pull-to-refresh behavior on mobile for the main list pages (tasks, notes, reminders) using a touch event handler that triggers `refetch()` from React Query.

### 8b. Haptic feedback

On mobile, add subtle haptic feedback on key actions (task complete, flashcard flip, session complete):
```typescript
if (navigator.vibrate) navigator.vibrate(10); // 10ms tap
```

Add to: DueTodayRow mark-complete, FlashCard flip, RatingButtons press, FocusTimer start.

### 8c. Swipe actions audit

Tasks already have swipe-to-complete. Consider adding swipe-to-delete for reminders and notes (iOS-style trailing swipe with red background).

---

## VERIFICATION

After ALL phases are complete, run:
```bash
cd C:\dev\prism
npx tsc --noEmit
npx next lint
npx next build
```

All three must pass green. Expected: 47+ pages, zero errors, zero warnings.

---

## ORDER OF EXECUTION

1. Phase 1 (bug fix) — highest urgency
2. Phase 2 (onboarding) — biggest SaaS signal
3. Phase 3 (error handling) — reliability
4. Phase 4 (keyboard + a11y) — professionalism
5. Phase 5 (polish) — consistency
6. Phase 6 (changelog) — shipping cadence
7. Phase 7 (performance) — optimization
8. Phase 8 (mobile) — delight
