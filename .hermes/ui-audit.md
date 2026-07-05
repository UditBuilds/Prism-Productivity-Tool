# Prism UI Audit Report

> Generated: 2026-07-05 | App: Prism (Next.js 14 App Router, Tailwind v3, shadcn v2, Radix, dark-mode-only, violet accent #7C3AED)

---

## 1. SCREEN INVENTORY

Every page with its file path, one-line description, and key states.

| # | Page | File Path | What It Renders | States |
|---|------|-----------|-----------------|--------|
| 1 | Landing | `app/page.tsx` | Marketing landing page (hero, features, pricing, footer) | No state — static content + auth redirect |
| 2 | Dashboard | `app/dashboard/page.tsx` | Server-rendered home: greeting, 4 stat cards, Due Today list, Upcoming countdowns/reminders | Loading (N/A — server-rendered, no skeleton), Empty (due tasks, upcoming both have inlines), Error (dueError shown inline at L347), Success |
| 3 | Tasks | `app/dashboard/tasks/page.tsx` | Client-rendered task list with 4 filter tabs, create/edit modal | Loading (`LoadingSkeleton` L145), Empty (custom `EmptyTasks` SVG L159 OR per-filter `EmptyState` L168), Error (`EmptyState` L147), Success |
| 4 | Task Detail | `app/dashboard/tasks/[id]/page.tsx` | Server-rendered detail view of a single task | No loading skeleton; Not Found (L49–63), Success |
| 5 | Notes | `app/dashboard/notes/page.tsx` | Client-rendered notes list with search, PDF/YouTube import, create/edit modal | Loading (`LoadingSkeleton` L115), Empty (custom `EmptyNotes` SVG L128 OR search-no-match `EmptyState` L140), Error (`EmptyState` L117), Success |
| 6 | Plans | `app/dashboard/plans/page.tsx` | Client-rendered plan list with 4 filter tabs, create/edit modal | Loading (`LoadingSkeleton` L133), Empty (`EmptyState` per filter L146; no `EmptyPlans` SVG), Error (`EmptyState` L135), Success |
| 7 | Reminders | `app/dashboard/reminders/page.tsx` | Client-rendered reminders + countdowns with 4 filter tabs, create/edit modal | Loading (`LoadingSkeleton` L161), Empty (custom `EmptyReminders` SVG OR per-filter `EmptyState`), Error (`EmptyState` L163), Success |
| 8 | Focus | `app/dashboard/focus/page.tsx` | Client-rendered focus timer: idle → running → completed (3 sub-views) | Idle: category/duration selection, recent sessions with skeleton; Running: countdown ring/progress + controls; Completed: celebration view |
| 9 | Calendar | `app/dashboard/calendar/page.tsx` | Client-rendered IST-aware month grid + selected-day details panel | Loading (custom `Skeleton` in day panel L248–252), Empty month (no specific marker, just grid with no dots), Empty day (inline "Nothing scheduled" L297–316), Error (`EmptyState` L254), Success |
| 10 | Learn | `app/dashboard/learn/page.tsx` | Server-rendered: fetches streak → passes to `LearnClient` | — |
| 11 | Learn (Client) | `components/srs/LearnClient.tsx` | Client deck list with stats, review-all-due CTA, YouTube analyzer, Analytics tab | Loading (inline `Skeleton` grid L222–234), Empty (`EmptyCards` SVG L247), Error (`EmptyState` L236), Success |
| 12 | Review Session | `app/dashboard/learn/review/page.tsx` | Client flashcard review session (SM-2 ratings, confetti on complete) | Loading (`Loader2` spinner L112), Empty ("All caught up" L143), Error (custom card L120), Active review (card flip + ratings), Session complete (confetti + result counts) |
| 13 | Weekly Review | `app/dashboard/review/page.tsx` | Client weekly review with KPIs, daily strip, focus breakdown, insights | Loading (custom `ReviewSkeleton` L81), Empty/no-activity (`EmptyState` inline L137), Error (`EmptyState` L83), Success |
| 14 | Settings | `app/dashboard/settings/page.tsx` | Client profile form, theme picker, notification controls | Loading (inline `Skeleton` L82–86), No explicit error state for profile save, Success |
| 15 | Login | `app/(auth)/login/page.tsx` | Client login form | Idle, Loading (spinner), Error (inline `text-danger` L76) |
| 16 | Signup | `app/(auth)/signup/page.tsx` | Client signup form | Idle, Loading (spinner), Error (inline `text-danger` L96) |
| 17 | Forgot Password | `app/(auth)/forgot-password/page.tsx` | Client forgot-password form + sent confirmation | Idle, Loading, Error, Sent (`MailCheck` + message L57) |
| 18 | Reset Password | `app/(auth)/reset-password/page.tsx` | Client reset-password form + expired-link card | Idle, Loading, Error, Link Expired (custom card L64–81) |
| 19 | Offline | `app/offline/page.tsx` | Static offline fallback page | Single static state — WifiOff icon + message |

**Loading states for each page:**
- `app/dashboard/loading.tsx`, `app/dashboard/tasks/loading.tsx`, `app/dashboard/notes/loading.tsx`, `app/dashboard/focus/loading.tsx`, `app/dashboard/learn/loading.tsx` exist but were not read in detail — they render fallback shells shown during server-side navigation.

---

## 2. DESIGN SYSTEM

### 2.1 Color Tokens (from `app/globals.css` L17–64)

All tokens defined in HSL in `:root, .dark` (neither is separate — dark mode is the only mode, effectively hardcoded).

| Token | CSS Variable | HSL Value | Hex Equivalent | Usage |
|-------|-------------|-----------|----------------|-------|
| Background | `--background` | `0 0% 4%` | `#0A0A0A` | Body background |
| Foreground / Text Primary | `--foreground` | `0 0% 96%` | `#F5F5F5` | Body text |
| Card | `--card` | `0 0% 7%` | `#111111` | Card component bg |
| Popover | `--popover` | `0 0% 10%` | `#1A1A1A` | Dropdowns/popovers |
| Surface | `--surface` | `0 0% 7%` | `#111111` | Card-like containers |
| Surface Raised | `--surface-raised` | `0 0% 10%` | `#1A1A1A` | Elevated panels |
| Border | `--border` | `0 0% 12%` | `#1F1F1F` | Default borders |
| Border Col | `--border-col` | `0 0% 16%` | `#2A2A2A` | Hover border / heavier |
| Input | `--input` | `0 0% 16%` | `#2A2A2A` | Form input border |
| Accent / Primary | `--accent` / `--primary` | `262 83% 58%` | `#7C3AED` | Violet accent |
| Accent Hover | `--accent-hover` | `263 70% 50%` | `#6D28D9` | Hover state |
| Accent RGB | `--accent-rgb` | `124 58 237` | — | For `rgb(var(--accent-rgb) / alpha)` |
| Accent Soft RGB | `--accent-soft-rgb` | `167 139 250` | — | Light end of gradient |
| Success | `--success` | `160 84% 39%` | `#10B981` | Completed/green |
| Warning | `--warning` | `38 92% 50%` | `#F59E0B` | Amber warnings |
| Danger / Destructive | `--danger` / `--destructive` | `0 84% 60%` | `#EF4444` | Errors/delete |
| Muted FG | `--muted-foreground` | `0 0% 53%` | `#888888` | Secondary text |
| Ring | `--ring` | `262 83% 58%` | `#7C3AED` | Focus ring color |

**Tailwind config** (`tailwind.config.ts` L36–82) maps these to Tailwind color tokens:
- `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`
- Prism extras: `surface`, `surface-raised`, `border-col`, `accent-hover`, `accent-soft`, `success`, `warning`, `danger`

Gradient bg-image tokens (L84–91): `accent-gradient`, `accent-gradient-hover`, `success-gradient`, `warning-gradient`, `danger-gradient`

Shadow tokens (L93–97): `glow-accent`, `glow-accent-sm`, `lift`

### 2.2 Font Stack

From `tailwind.config.ts` L12–29:
- **Sans**: `var(--font-inter)` → `ui-sans-serif`, `system-ui`, `-apple-system`, `Segoe UI`, `Roboto`, `sans-serif`
- **Mono**: `var(--font-jetbrains-mono)` → `ui-monospace`, `SFMono-Regular`, `Menlo`, `Consolas`, `monospace`

Fonts loaded in `app/layout.tsx` L2, L6 via `next/font/google`: Inter (latin subset, swap display) and JetBrains Mono (latin subset, swap display).

### 2.3 Component Library

**shadcn v2 with Radix primitives** — 16 UI components in `components/ui/`:

| Component | File | Radix Dependency |
|-----------|------|-----------------|
| Button | `button.tsx` | `@radix-ui/react-slot` |
| Card | `card.tsx` | None (pure div) |
| Tabs | `tabs.tsx` | `@radix-ui/react-tabs` |
| Skeleton | `skeleton.tsx` | None (uses `.skeleton-shimmer` CSS) |
| Badge | `badge.tsx` | None |
| Dialog | `dialog.tsx` | `@radix-ui/react-dialog` |
| Input | `input.tsx` | None |
| Select | `select.tsx` | `@radix-ui/react-select` |
| Switch | `switch.tsx` | `@radix-ui/react-switch` |
| Textarea | `textarea.tsx` | None |
| Calendar | `calendar.tsx` | `react-day-picker` |
| Popover | `popover.tsx` | `@radix-ui/react-popover` |
| Dropdown Menu | `dropdown-menu.tsx` | `@radix-ui/react-dropdown-menu` |
| Avatar | `avatar.tsx` | `@radix-ui/react-avatar` |
| Label | `label.tsx` | `@radix-ui/react-label` |
| Separator | `separator.tsx` | `@radix-ui/react-separator` |

### 2.4 CSS Animation Keyframes

**In `tailwind.config.ts` (L99–170):**
- `accordion-down`, `accordion-up` — Radix accordion (not used on pages)
- `fade-up` — opacity + translateY(8px) → reset
- `fade-in` — opacity 0 → 1
- `slide-in-right` — translateX(16px) → 0 + fade
- `shake` — horizontal jitter (form errors)
- `bell-ring` — rotation ring (reminder bell)
- `float` — translateY(-6px) bounce
- `breathe` — scale + opacity pulse
- `pulse-ring` — box-shadow expand (CTA emphasis)
- `shimmer` — backgroundPosition sweep
- `flicker` — scale + rotate jitter with opacity
- `pop` — scale overshoot (0.9 → 1.06 → 1)
- `spin-slow` — 360° rotation over 6s
- `underline-grow` — scaleX underline

**In `app/globals.css` (L154–341):**
- `gradient-pan` (L154–161) — for `.text-gradient-animated` (logo wordmark)
- `stagger-fade-up` (L203–212) — for `.stagger-children` list entrance
- `skeleton-sweep` (L232–239) — accent-tinted shimmer for `.skeleton-shimmer`
- `particle-rise` (L252–267) — floating dots (empty state celebrations)
- `confetti-burst` (L281–291) — session-complete celebration
- `aurora-drift` (L334–341) — landing hero blobs
- SRS flashcard 3D flip (L358–379) — pure CSS `rotateY(180deg)` with `perspective: 1600px`

**Animation utility classes in tailwind config (L171–189):**
`animate-accordion-down`, `animate-accordion-up`, `animate-fade-up`, `animate-fade-in`, `animate-slide-in-right`, `animate-shake`, `animate-bell-ring`, `animate-bell-ring-loop`, `animate-float`, `animate-breathe`, `animate-pulse-ring`, `animate-shimmer`, `animate-flicker`, `animate-pop`, `animate-spin-slow`, `animate-underline-grow`

### 2.5 Utility Classes

**Defined in `app/globals.css`:**
- `.text-gradient` (L129–138) — accent gradient text (accent-soft → accent, 100deg)
- `.text-gradient-animated` (L141–153) — panning gradient text (logo wordmark)
- `.glass` (L164–168) — blur backdrop with semi-transparent bg
- `.gradient-border` (L172–184) — gradient border via double-background trick with `--gb-bg` override
- `.stagger-children` (L187–201) — staggered fade-up entrance for children (caps at 12)
- `.skeleton-shimmer` (L215–231) — accent-tinted shimmer sweep for skeleton loaders
- `.particle-dot` (L243–251) — floating accent dot (empty states, celebrations)
- `.confetti-dot` (L271–291) — outward burst dots for session completions
- `.aurora` (L295–341) — CSS-only aurora backdrop for landing hero
- `.btn-primary-shimmer` (L428–450) — primary button hover shimmer effect
- `.card-scene`, `.card-3d`, `.card-face` (L358–379) — SRS flashcard 3D flip
- `.pb-safe`, `.pt-safe` (L455–460) — safe-area insets for notched phones
- `.scrollbar-none` (L463–469) — hide scrollbar
- `.scroll-touch` (L472–474) — momentum scrolling
- `.prose-preview` (L526–664) — rendered markdown styling (headings, lists, code, tables, blockquotes, links)

### 2.6 Theme System (6 Accent Colors)

From `app/globals.css` L68–97 and `components/settings/ThemeCard.tsx`:

| Theme Class | Accent RGB | Accent Hover RGB | Accent Soft RGB | Hex (approx) |
|-------------|-----------|-----------------|-----------------|--------------|
| `theme-violet` (default) | `124 58 237` | `109 40 217` | `167 139 250` | `#7C3AED` |
| `theme-blue` | `59 130 246` | `37 99 235` | `96 165 250` | `#3B82F6` |
| `theme-emerald` | `16 185 129` | `5 150 105` | `52 211 153` | `#10B981` |
| `theme-amber` | `245 158 11` | `217 119 6` | `251 191 36` | `#F59E0B` |
| `theme-rose` | `244 63 94` | `225 29 72` | `251 113 133` | `#F43F5E` |
| `theme-cyan` | `6 182 212` | `8 145 178` | `34 211 238` | `#06B6D4` |

Theme applied by `ThemeProvider` (`components/providers/ThemeProvider.tsx`) as `html.theme-{id}` class. Flash-of-wrong-theme prevented by inline `<script>` in `app/layout.tsx` L57–60 that reads `localStorage.getItem("prism-theme")` before first paint.

### 2.7 Dark Mode

**Dark mode is hardcoded.** `app/layout.tsx` L52 sets `className="dark"` on `<html>` without any conditional logic. `tailwind.config.ts` L4: `darkMode: ["class"]` — but no light mode variant exists anywhere. `:root` and `.dark` in `globals.css` L17–18 are the same selector. There is no mechanism to switch to light mode.

---

## 3. PER-SCREEN GAPS

### 3.1 Landing Page (`app/page.tsx` → `components/landing/LandingPage.tsx`)

- **Missing aria-labels**: Feature section images/mockups use `aria-hidden` correctly, but the feature-row `Link` "Start free" (L300, L574) has no `aria-label` — just text content.
- **Hardcoded colors**: Pricing-card price uses `text-foreground` (OK) but features list uses inline `text-muted-foreground` (OK, that's a token). Mockup elements use hardcoded hex like `bg-[#0D0D0D]` (L142, L170) — these are decorative, but miss theme coherence.
- **Inline styles**: TrustBar (L259) uses `bg-surface/30` — OK, token-based.
- **No loading state**: Entirely static CSS mockups — no loading needed.
- **Polished elements**: Aurora backdrop, `gradient-border` cards, `text-gradient-animated` wordmark, `btn-primary-shimmer` — these are well above v1.

### 3.2 Dashboard Home (`app/dashboard/page.tsx`)

- **No loading skeleton**: Server-rendered page has no loading.tsx that matches the final layout — just `app/dashboard/loading.tsx` (not inspected but likely generic).
- **Inconsistent empty states**: `Due Today` empty (L355–377) uses a custom inline card with `particle-dot` decorations, `Coffee` icon, and a "Add a task →" link. `Upcoming` empty (L410–429) uses a simpler version — dashed border card with centered text and two CTA buttons. These feel like two different designers.
- **Hardcoded `text-white`**: Stat card value at L273: `"text-white"` instead of `"text-foreground"` — the one exception is the "Done This Week" sparkline variant which uses gradient text.
- **Stat cards**: 4 inline stat cards (L242–316) with identical structure. Not a shared component. The `hover:border-accent/30`, `hover:bg-surface-raised/60`, `hover:shadow-lift` pattern is repeated verbatim.
- **Section header pattern**: Two section headers — "Due Today" (L321–340) and "Upcoming" (L396–408) — both use the same `text-gradient text-base font-semibold` + accent left bar pattern. This is a candidate for a shared `SectionHeader` component.
- **"View all" link arrow**: Uses raw `→` character at L341 — not a Lucide icon.
- **Upcoming countdown tone classes**: Uses hardcoded `text-amber-400` (L440, L491) instead of `text-warning` token.
- **Inline progress bar**: Countdown progress bars use inline `style={{ width: ... }}` — fine for dynamic values, but the bar itself has no accessible label.
- **Missing aria-label on stat cards**: Stat cards (L242) are `div` without `role` — they're decorative, but lack `aria-label` for screen readers.

### 3.3 Tasks Page (`app/dashboard/tasks/page.tsx`)

- **Loading skeleton uses `LoadingSkeleton` with `count={3}`** (L145) — renders 3 card skeletons. The actual `TaskList` (L175) uses `grid-cols-1 lg:grid-cols-2` with `stagger-children`. The `LoadingSkeleton` component also uses `grid-cols-1 lg:grid-cols-2` — good match.
- **Tabs consistent with Reminders/Plans**: Count badge with `bg-accent/20 text-accent` (L132) — identical pattern on all three pages (L131–133 here, L143–145 reminders, L117–119 plans).
- **Works**: PullToRefresh wrapping (L93, L180), proper error/loading/empty states, `PageHeader` with CTA.
- **Miss**: No page transition animation beyond `animate-fade-up` on outer div — same as all pages. No per-tab transition when switching filters.
- **EmptyTasks SVG** (L159) uses the shared `EmptyShell` component from `EmptyStates.tsx` — good reuse.

### 3.4 Task Detail (`app/dashboard/tasks/[id]/page.tsx`)

- **No loading skeleton**: Server-rendered — displays instantly or shows "Task not found" (L49–63). If the query is slow, there's no loading indicator. The `loading.tsx` at `app/dashboard/tasks/loading.tsx` handles the segment-level loading, but the detail page has its own async data fetch.
- **"Not found" card** (L53–61): Uses inline dashed-border card — not the shared `EmptyState` component. Uses `AlertCircle` with `text-muted-foreground` (L54) instead of `text-danger` — it's a "not found" not an error, so this is intentional and reasonable.
- **Hardcoded border color**: Detail card (L80) uses `border-border bg-surface` — proper tokens.
- **No action buttons**: Detail page is read-only. No "Edit" or "Delete" button.
- **Missing aria-labels**: Priority/status badges (L91–104) lack `aria-label`.

### 3.5 Notes Page (`app/dashboard/notes/page.tsx`)

- **Search bar hidden when no notes**: L91: `{hasNotes && (...)}` — the search bar only renders when there's at least one note. If the user is on the empty state, they can't reach search (doesn't matter since there's nothing to search).
- **Good**: PullToRefresh (L55, L176), `LoadingSkeleton`, `EmptyState` for error, `EmptyNotes` SVG for global empty, per-search-match empty with "Clear search" action.
- **Missing**: No `aria-label` on search input (L94–99) — the `Search` icon is presentational only.
- **NoteCard click**: `onOpen` callback passes both note and mode — used for view and edit. Consistent.

### 3.6 Plans Page (`app/dashboard/plans/page.tsx`)

- **No PullToRefresh**: Unlike Tasks, Notes, and Reminders, the Plans page lacks PullToRefresh (L89 — just `<div className="animate-fade-up">`).
- **No shared empty SVG**: Unlike Tasks/Notes/Reminders, there is no `EmptyPlans` component. All empty states use the generic `EmptyState` with per-filter icons (L146).
- **Tabs**: Uses same `TabsList className="grid w-full grid-cols-4"` pattern as Tasks and Reminders — but Plans has no short labels and no responsive text truncation (L115 — just `<span className="truncate">{tab.label}</span>`). That's fine because "Active", "Completed", "Archived" are short enough.
- **Works**: Stats computation (L63–72) passes `PlanTaskStat` to PlanList. All states handled.

### 3.7 Reminders Page (`app/dashboard/reminders/page.tsx`)

- **Notification enable banner** (L104–118): Uses `border-accent/30 bg-accent/10` — consistent with the design system. Good.
- **Tab pattern**: Matches Tasks exactly — grid-cols-4, shortLabel responsive text, count badge.
- **Countdowns tab delegation**: `filter === "countdowns"` renders `<CountdownsTab />` (L159) which has its own loading/empty states.
- **Works**: All states covered. PullToRefresh present.

### 3.8 Focus Page (`app/dashboard/focus/page.tsx`)

- **3-state architecture**: `IdleView`, `RunningView`, `CompletedView` — each a separate function component at the module level (unexported). No unified layout wrapper.
- **IdleView (L51–412)**:
  - Has `PageHeader` (L139–143) — good.
  - Category selector (L146–190): Uses horizontal scroll with `scrollbar-none`. Buttons use hardcoded `border-[#2A2A2A]` hover at L379 on the recent sessions list, and `border-border` elsewhere. Inconsistent.
  - Mode toggle (L264–286): Uses `aria-pressed` (good). `bg-accent-gradient` for active — consistent with design system.
  - Duration selector (L294–337): Custom minutes input uses `aria-label="Custom minutes"` (L333) — good.
  - Start button (L342–353): Uses `animate-pulse-ring` when `canStart` — good CTA emphasis.
  - Recent sessions skeleton (L362–366): Inline `Skeleton` elements, not `LoadingSkeleton` component. The empty state (L367–371) is a simple `<p>` — not using `EmptyState`. This is below the quality of other pages.
  - "Try completing one full session" hint (L403–407): Nice nudge text.
- **RunningView (L417–465)**:
  - No `PageHeader` — just starts with a centered label and the timer ring. The page feels like a different app.
  - Timer digits (L498): Uses inline `style={{ textShadow: "0 0 32px rgb(var(--accent-rgb) / 0.45)" }}` — accent-themed, good.
  - **Hardcoded `text-white`** (L498): Timer digits use `text-white` instead of `text-foreground`.
  - Progress ring uses SVG circle with `stroke-dasharray`/`stroke-dashoffset` — not inspected in full, but follows the `FocusPage.tsx` L501+.
  - Controls sticky bottom bar uses `sticky bottom-[calc(...)]` — mobile-aware.
- **CompletedView**: Not inspected in detail (L466+ truncated) — confetti celebration view.
- **No PageHeader in Running/Completed states**: The breadcrumb-like header disappears when the timer is active. This is intentional (immersive mode) but loses the "Focus" title and subtitle.

### 3.9 Calendar Page (`app/dashboard/calendar/page.tsx`)

- **Month navigation**: Uses custom buttons (L149–164) with `aria-label="Previous month"` and `aria-label="Next month"` — good. "Today" button (L141–148) uses `Button variant="ghost"`.
- **Day cells**: Grid of 42 fixed cells (L181–229). Each cell is a `<button>` with `aria-label={cell.date}` and `aria-pressed` — good accessibility.
- **Today indicator**: Uses `border border-accent/60 font-semibold shadow-glow-accent-sm ring-1 ring-inset ring-accent/30` (L203–204) — distinctive and clear.
- **Selected day**: Uses `bg-accent-gradient` (L201) — consistent accent application.
- **Legend** (L233–242): Hardcoded `bg-accent` (tasks) and `bg-amber-400` (reminders) — reminders dot uses hardcoded amber, not `bg-warning`.
- **Day details panel** (L246–272):
  - Empty day (L298–316): Uses inline card — NOT the shared `EmptyState` component. Has a custom `CalendarIcon` in a circle and "Add a task →" link. This is the 3rd different empty-state pattern.
  - Skeleton loading (L248–252): Uses individual `Skeleton` components, not `LoadingSkeleton`.
  - Task/reminder list items (L327–350, L362–379): Uses `bg-surface-raised/50` — slightly different from the TaskCard `bg-[#111111]` on the Tasks page. The priority badge uses the shared `priorityStyles` from `task-styles.ts` (L344) — good reuse.
  - Links at bottom (L383–398): "View tasks →" and "View reminders →" — consistent link pattern.

### 3.10 Learn Page (`app/dashboard/learn/page.tsx` + `LearnClient.tsx`)

- **Server/client split**: Server page computes streak, passes to `LearnClient`. Clean pattern.
- **Stats banner** (LearnClient L148–197): 3 stat cards inline, identical structure to dashboard stats but with differences:
  - No `hover:scale-[1.01]` or `hover:shadow-lift` on individual cards? Actually L155: `hover:scale-[1.01] hover:border-accent/30 hover:shadow-lift` — yes, present.
  - Label uses `text-xs text-muted-foreground sm:text-sm` (L159) — no uppercase tracking-widest, unlike dashboard stat cards which use `text-xs font-medium uppercase tracking-widest text-muted-foreground`.
  - Values: Streak uses `text-gradient` (L173), others use `text-foreground` — inconsistent value coloring.
  - Flame icon for streak (L164): Uses hardcoded `text-orange-400` and inline `drop-shadow` — not a theme token.
  - Freeze indicator (L181–186): Uses hardcoded `text-destructive` (L184) and `text-cyan-300/90` with inline `drop-shadow` (L185).
- **Review All Due CTA** (L201–207): `animate-pulse-ring` on button — good CTA emphasis.
- **Deck list skeleton** (L222–234): Uses inline `Skeleton` components, not `LoadingSkeleton`.
- **Lazy-loaded AnalyticsPanel** (L29–49): Uses `dynamic()` with a custom skeleton fallback — good lazy loading.
- **Tabs** (L140–143): `max-w-xs grid-cols-2` — narrower than the 4-column filter tabs on Tasks/Reminders/Plans, but appropriate for 2 tabs.

### 3.11 Review Session (`app/dashboard/learn/review/page.tsx`)

- **Loading** (L106–116): Uses `Loader2` spinner with role="status" — not a skeleton. Acceptable for a flashcard session.
- **Error** (L118–138): Custom card with `border-danger/30 bg-danger/10` — not using `EmptyState` component.
- **Nothing due** (L141–155): Custom card with `border-success/30 bg-success/10` + `CheckCircle2` — not using `EmptyState`.
- **Session complete** (L159–242): Confetti dots, rating breakdown grid, "Review again" button — polished.
- **Active review** (L249–303):
  - Progress bar: `bg-gradient-to-r from-accent via-accent-soft to-emerald-400` — green gradient extension is unique to this page.
  - Controls sticky at bottom: `sticky bottom-[calc(4rem_+_env(safe-area-inset-bottom))]` — mobile-thumb-zone design.
  - **Hardcoded border**: Sticky bar border uses `border-[#1A1A1A]` (L283) — not a theme token.
  - "End session early" link (L295–300): Plain `<Link>` with `text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline` — very subtle, could be missed on mobile.
- **Missing**: No `aria-label` on the flashcard button in `FlashCard.tsx` — but L77–78 show `aria-label` is present: `aria-label={isFlipped ? "Show question" : "Reveal answer"}` — good.

### 3.12 Weekly Review Page (`app/dashboard/review/page.tsx`)

- **Custom skeleton** (L100–118): `ReviewSkeleton` is a page-specific skeleton, not using `LoadingSkeleton`. It renders 4 stat card skeletons + 7 row skeletons — better fit for the layout than the generic one.
- **No activity state** (L136–155): Uses shared `EmptyState` with a `CalendarCheck` icon and "Start a focus session" CTA — good reuse, but also has a week label paragraph (`text-xs text-muted-foreground/60`, L139) above it, which is outside the EmptyState.
- **KPI cards** (L174–188): 4 stat cards inline — identical to the dashboard stat card pattern but with `text-gradient` on values. Has `hover:scale-[1.01] hover:border-accent/30 hover:shadow-lift` — matches dashboard.
- **Day-by-day strip** (L199–282): Polished. Each day row has mood emoji, activity summary, focus bar scaled to week max, "Best" badge with `bg-accent-gradient`, "Today" badge.
- **Week selector** (L54–76): Uses `aria-pressed` — good. Active state uses `bg-surface-raised text-foreground shadow-sm shadow-black/40` (L69) — slightly different from the Focus page mode toggle which uses `bg-accent-gradient`.
- **Hardcoded `text-white`** on best/quiet day labels: L385: `text-lg font-bold text-white` — should be `text-foreground`.
- **Focus breakdown** (L287–324): Bar colors use `categoryChartColor()` which may return hardcoded hex — depends on the implementation in `useFocusCategories`.

### 3.13 Settings Page (`app/dashboard/settings/page.tsx`)

- **No error state**: The `save` mutation has `onError` toast (L49–50), but the form itself shows no inline error message.
- **Profile skeleton** (L82–86): Inline `Skeleton` for 3 fields — appropriate for a form.
- **Avatar**: Inline gradient-ring avatar (L68–72) — duplicate of sidebar avatar pattern. Could be a shared `UserAvatar` component.
- **"Email can't be changed"** (L116): `text-xs text-muted-foreground` — appropriate microcopy.
- **ThemeCard** (L130): Renders color dots with `aria-label="{label} accent"` (L23), `aria-pressed` (L24) — good accessibility. Uses inline `style` for `boxShadow` and `backgroundColor` — unavoidable for dynamic color.
- **NotificationsCard** (L131): Full state matrix: loading (`permission === null` → Skeleton), unsupported (message), granted+subscribed (success pill + disable btn), denied (danger pill + instructions), default (warning pill + enable btn). Well-handled.

### 3.14 Auth Pages (`(auth)/login`, `(auth)/signup`, `(auth)/forgot-password`, `(auth)/reset-password`)

- **Consistent shell**: All use `AuthCard` + `AuthHeader` from `components/auth/AuthCard.tsx`.
- **AuthCard** (L7–24): Uses `gradient-border` + `animate-fade-up` + optional `animate-shake` on error. Good reuse.
- **AuthHeader** (L27–41): `text-gradient-animated` wordmark, tagline, optional per-page subtitle.
- **Layout** (`app/(auth)/layout.tsx`): Centers card with `min-h-screen`, radial gradient background. Has `ErrorBoundary` wrapping children.
- **Loading**: All forms show `Loader2` spinner in button during submission — good.
- **Error**: All show `text-sm text-danger` with `role="alert"` — good.
- **Forgot password "sent" state** (L56–67): Uses `MailCheck` icon with `text-success` + descriptive text. Clean.
- **Reset password "expired" state** (L63–81): Uses `AlertTriangle` icon with `text-warning` + "Request a new link" CTA. Clean.
- **Missing**: No `aria-describedby` connecting error messages to inputs.

### 3.15 Offline Page (`app/offline/page.tsx`)

- **Simple static page**: `WifiOff` icon with `text-accent`, centered card with `text-foreground`/`text-muted-foreground`. Adequate for a fallback.
- **No action**: No "Retry" or "Go back" button — the PWA's service worker handles recovery.

### 3.16 Cross-Cutting Shell Components

- **Sidebar** (`components/layout/Sidebar.tsx`):
  - Active nav item: `bg-[linear-gradient(to_right,rgb(var(--accent-rgb)/0.18),transparent)] text-accent` (L41) — good, follows theme.
  - Active glow dot: `bg-accent shadow-glow-accent-sm` (L49) — nice detail.
  - Logout button: `hover:text-danger` (L125) — good.
  - **Hardcoded bg**: Sidebar background `bg-[#0D0D0D]` (L78) — not using `bg-background` or a token. Slightly lighter than `--background` (#0A0A0A).
  - NavItem memoization (L20–63): Good performance optimization with primitive badge counts.

- **TopBar** (`components/layout/TopBar.tsx`):
  - Sticky with `backdrop-blur-xl` and conditional `shadow-lg shadow-black/30` on scroll (L94–97) — polished.
  - Live IST clock (L62–67): `useEffect` + setInterval every 60s — good.
  - Reminder bell: `animate-bell-ring text-accent` with dot indicator (L123–133) — polished.
  - Avatar dropdown: `bg-accent/15 text-accent shadow-glow-accent-sm ring-1 ring-accent/30` (L140) — matches sidebar avatar.

- **MobileNav** (`components/layout/MobileNav.tsx`):
  - `backdrop-blur-xl` (L15) — matches TopBar.
  - Active icon: `text-accent` + `bg-accent/[0.12]` (L31) with glow dot above (L35–41).
  - `pb-safe` for home indicator (L15) — good.

- **PageHeader** (`components/layout/PageHeader.tsx`):
  - Used by: Tasks, Notes, Plans, Reminders, Focus (IdleView), Calendar, Learn, Settings, Weekly Review — 9 of 10 dashboard pages. Task detail does not use it.
  - Icon container: `border-accent/20 bg-accent/10 shadow-glow-accent-sm` (L19) — consistent across all pages.
  - Title: `text-gradient truncate text-xl font-semibold tracking-tight` (L24) — consistent.
  - Subtitle: `text-[13px] text-muted-foreground/80` (L28) — consistent.

---

## 4. REUSABLE PATTERNS

### 4.1 Patterns Appearing on 3+ Screens That Should Be Shared Components

#### A. Stat Cards

**Screens**: Dashboard (L242–316), Learn (LearnClient L148–197), Weekly Review (L174–188).

Each renders 3–4 cards with: icon, label (uppercase tracking-widest), large value, optional sparkline or subtitle.

**Differences**:
- Dashboard: `text-xs font-medium uppercase tracking-widest` label, `text-3xl font-bold tabular-nums` value with conditional `text-white`/gradient, `hover:scale-[1.01] hover:border-accent/30 hover:bg-surface-raised/60 hover:shadow-lift`, conditional `animate-pulse-ring` and `animate-breathe`/`animate-bell-ring-loop`.
- Learn: `text-xs text-muted-foreground sm:text-sm` label (no uppercase tracking), `text-2xl font-semibold` value, same hover states, `animate-flicker` on streak icon.
- Weekly Review: `text-[11px] font-medium uppercase tracking-widest text-muted-foreground/70` label, `text-gradient text-2xl font-bold tabular-nums tracking-tight` value, same hover states.

**Recommendation path**: Extract a `<StatCard>` component with props for icon, label, value (string | number), variant (accent gradient vs plain vs sparkline), and optional animation.

#### B. Section Headers

**Screens**: Dashboard (L320–340 "Due Today", L396–408 "Upcoming"), Focus (L357–359 "Recent sessions"), Learn (L219–220 "Decks"), Weekly Review (L199–202 "Day by day").

**Pattern**: `text-gradient text-base font-semibold` + often an accent left bar (`h-5 w-0.5 bg-accent rounded-full`).

**Differences**:
- Dashboard has the accent bar (L323–325) and optional count badge + "View all" link.
- Focus, Learn, and Weekly Review "Day by day" have the accent bar (L201: `border-l-2 border-accent pl-3`), but "Recent sessions" and "Decks" do not.
- Weekly Review uses `border-l-2 border-accent pl-3` instead of the `span.h-5.w-0.5` bar.

**Recommendation path**: Extract a `<SectionHeader>` component with optional badge, optional action link, and optional accent bar.

#### C. Filter Tabs With Count Badges

**Screens**: Tasks (L106–141), Reminders (L120–155), Plans (L103–129).

Identical pattern: `TabsList className="grid w-full grid-cols-4"` with `TabsTrigger` containing a truncated label + a count pill: `bg-accent/20 text-accent` when active, `bg-muted text-muted-foreground` otherwise.

**Drift**: All three implement this identically. The tab `{ value, label, shortLabel? }` shape is the same.

**Recommendation path**: Already consistent — extract to a shared `<FilterTabs>` if more pages add tabs, otherwise low priority.

#### D. Pull-to-Refresh Wrapper

**Screens**: Tasks (L93, L180), Notes (L55, L176), Reminders (L91, L196).

**Missing from**: Plans page. All content pages use `useQuery` / `useTasksQuery` etc. — Plans has `usePlansQuery` but no PullToRefresh.

**Recommendation path**: Add PullToRefresh to the Plans page for consistency.

#### E. Empty States

**Inconsistency**: The app has multiple empty-state patterns:
1. **Shared `EmptyState` component** (`components/shared/EmptyState.tsx`): Used for errors and per-filter empties on Tasks, Notes, Plans, Reminders, Learn, Weekly Review, Calendar. Always: centered icon in bordered circle, title, description, optional action.
2. **Shared `EmptyShell` with SVG** (`components/shared/EmptyStates.tsx`): Used for `EmptyTasks`, `EmptyNotes`, `EmptyReminders`, `EmptyCards`. Always: custom SVG with accent glow filter, title, subtitle, optional hint chip, optional action.
3. **Inline custom empties**: 
   - Dashboard "Upcoming" (L410–429): Different structure — just dashed border + "Nothing coming up" + two CTA buttons side by side.
   - Dashboard "Due Today" (L355–377): Different — particle dots, Coffee icon, "All clear for today", link.
   - Calendar day panel "Nothing scheduled" (L298–316): Calendar icon in circle, title, subtitle, link.
   - Focus "Recent sessions" empty (L367–371): Just a `<p>` with dashed border — plain text, no icon, no CTA.
   - Review session error/nothing-due: Custom cards (L120, L143) — distinct from `EmptyState`.

**Recommendation path**: Consolidate to 2 patterns: (a) `EmptyState` for errors and per-filter empties, (b) `EmptyShell`/specific SVGs for first-run full-page empties. Dashboard and Calendar inline empties are close to pattern (a) but missing the bordered-circle icon container.

#### F. Progress Bars

**Screens/Components**: Dashboard (countdown progress, L459–473), Calendar (day focus bar, L270–277), Weekly Review (focus breakdown bars, L312–320), Review Session (card progress, L265–268), DeckCard (deck progress, L76–81).

All share the same structure: `<div className="h-1 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full ..." style={{ width: ... }} /></div>`.

**Differences**: Fill color — some use `bg-accent-gradient`, some use inline `backgroundColor`, some use `bg-gradient-to-r from-accent via-accent-soft to-emerald-400`.

A shared `<ProgressBar value={pct} variant="accent" | "category" | "review" />` would reduce duplication.

#### G. Icon + Avatar Ring

**Screens**: Settings avatar (L68–72), Sidebar avatar (L116), TopBar avatar (L140).

All three render initials in a circle with: `bg-accent/15 text-accent shadow-glow-accent-sm`. Settings adds a gradient ring wrapper (`bg-accent-gradient p-[2px]`). Sidebar adds `ring-1 ring-accent/30`. TopBar matches Sidebar.

Three implementations of the same visual. A `<UserAvatar initials={...} size="sm" | "md" | "lg" />` would unify these.

### 4.2 Good Implementation vs. Worse Implementation of Same Pattern

| Pattern | Good Implementation | Worse Implementation |
|---------|--------------------|--------------------|
| **Empty state** | Tasks/Notes/Reminders first-run (`EmptyShell` + SVG, proper icon glow, hint chip) | Focus "Recent sessions" empty (plain `<p>`, no icon, no CTA) |
| **Error state** | Tasks/Notes/Plans/Reminders all use `EmptyState` with `AlertCircle`, title, description, "Try again" button | Review session error (custom card, similar but not using shared component) |
| **Loading skeleton** | Tasks/Notes/Reminders use `LoadingSkeleton` with `count` | Focus uses inline `Skeleton` elements; Calendar uses inline single `Skeleton`s; Weekly Review uses custom `ReviewSkeleton`; Learn uses inline skeleton grid |
| **Page transition** | All pages use `animate-fade-up` on root div | Dashboard home uses it (L215) — but tasks/notes/reminders wrap it inside `PullToRefresh`, making the fade-up only apply to the PullToRefresh container |
| **Section heading** | Dashboard "Due Today" with accent left bar + count badge + "View all" link | Focus "Recent sessions" — same gradient text heading but no accent bar, no badge, no link |
| **CTA button** | Tasks/Notes/Reminders: `Button onClick={...} className="rounded-lg"` with icon+text | Dashboard "View all" link (L333): `<Link>` with `text-accent hover:text-accent-hover` and raw `→` character — not a Button component |
| **Tab switcher** | All three pages (Tasks/Reminders/Plans) use identical pattern | Weekly Review uses a custom inline button group (L54–76) instead of `Tabs` component — different visual language |
| **Stat card** | Dashboard: 3D hover, conditional animations, sparkline | Learn: simpler, no uppercase tracking on labels, hardcoded orange flame icon color |

### 4.3 Hardcoded Colors (Across All Screens)

| Location | Hardcoded Value | Should Be |
|----------|----------------|-----------|
| Sidebar L78 | `bg-[#0D0D0D]` | `bg-background` or a token |
| Dashboard L273 | `text-white` (stat value) | `text-foreground` |
| Dashboard L440, L491 | `text-amber-400` | `text-warning` |
| Focus L379 | `border-[#2A2A2A]` (recent sessions hover) | `border-border-col` |
| Focus L498 | `text-white` (timer digits) | `text-foreground` |
| Calendar L222 | `bg-amber-400` (reminder dot) | `bg-warning` |
| Calendar L239 | `bg-amber-400` (legend dot) | `bg-warning` |
| Learn L165 | `text-orange-400` (flame icon) | Should be accent-dependent or use a token |
| Learn L185 | `text-cyan-300/90` (freeze indicator) | Should use a token or be accent-consistent |
| Review session L283 | `border-[#1A1A1A]` (sticky bar) | `border-border` |
| Weekly Review L385 | `text-white` (best/quiet day label) | `text-foreground` |
| Prose CSS L535, L542, L553 | `color: white` (headings) | `color: hsl(var(--foreground))` or inherit |
| Prose CSS L598, L606 | `background-color: #1a1a1a` (code/pre) | `background-color: hsl(var(--surface-raised))` |
| Scrollbar L411, L418 | `#262626`, `#3a3a3a` | Could use CSS variables |

---

*End of audit. 19 screens analyzed. Key themes: design system is well-defined but inconsistently applied. Stat cards, section headers, and empty states are prime candidates for shared-component extraction. Dashboard and Focus pages have the most inline/custom patterns that deviate from shared components.*
