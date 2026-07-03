# Fable 5 — Prism Full Frontend Overhaul

> Hand this entire document to Fable 5. It contains everything Fable 5 needs to redesign every page and component in Prism.

---

## CONTEXT: What Prism Is

AI-native productivity + spaced-repetition PWA. Tasks, notes, plans, reminders, calendar, focus timer, countdowns, mood tracking, SM-2 flashcard review, 3 AI flashcard pipelines (notes → cards, PDF → cards, YouTube → cards), learning/productivity analytics, PWA with web push. 2 users, 76 commits, 43 routes.

**Live:** prism-productivity-tool.vercel.app
**Repo:** C:\dev\prism

## TECH CONSTRAINTS (DO NOT BREAK)

- **Tailwind CSS v3** — do NOT use Tailwind v4 syntax or classes
- **shadcn/ui v2** (Radix primitives) — do NOT upgrade to shadcn v3
- **Next.js 14 App Router** — Server Components by default, `"use client"` only where needed
- **React 18**, TypeScript strict (zero `any`)
- **Dark mode ONLY** — no light mode, no toggle
- **Accent color: violet #7C3AED** (HSL 262 83% 58%, mapped to `rgb(var(--accent-rgb))` which supports 6 themeable colors: violet, blue, emerald, amber, rose, cyan)
- **Fonts:** Inter (Geist) + JetBrains Mono
- **Mobile-first:** 375px minimum, safe-area insets (iPhone Dynamic Island / home indicator)
- **IST timezone** — all dates use `lib/date.ts` helpers, never raw `new Date()`
- **Recharts is CLIENT-ONLY** — cannot render in Server Components (dashboard is a server component)
- **CSS 3D card flip** for flashcards uses `.card-scene`, `.card-3d`, `.card-face` classes — preserve these
- **No Tailwind v4**, no shadcn v3, no major version bumps

## DESIGN DIRECTION

Reference quality: **Linear, Vercel, Raycast**. Not "shadcn default." Udit prefers dark-mode UI with bold accent colors (violet/purple). Current app is already dark + violet but reads as "default shadcn" — the upgrade needs to inject identity, depth, and motion.

### Design System Tokens (current → target)

| Token | Current | Target |
|-------|---------|--------|
| Background | `#0A0A0A` pure black | Keep, but add subtle grain or radial gradient vignette |
| Cards | Flat `bg-surface #111` + 1px border | Glass-morphism on hover, subtle inner shadow, elevated depth layers |
| Borders | `#1F1F1F` everywhere | Variable: softer inner borders, brighter interactive borders |
| Typography | Inter, functional | Keep Inter + JetBrains Mono but add gradient text for key numbers (streaks, KPI values) |
| Spacing | Standard Tailwind (p-4, p-6) | Tighter information density on cards, more breathing room between sections |
| Radius | `0.75rem` (rounded-xl) | Keep, but vary: tighter radius on small chips, larger on hero cards |
| Motion | `150ms` linear on everything | Staggered list reveals, spring physics on cards, page entrance animations |

---

## PAGE-BY-PAGE REDESIGN SPECS

### 1. AUTH PAGES (`app/(auth)/login`, `signup`, `forgot-password`, `reset-password`)

**Current:** Centered card on black background, purple "PRISM" logo, standard inputs.

**Fable 5 target:**
- Animated PRISM logo — letters fade in one by one or subtle pulse glow
- Gradient border on the auth card (violet → transparent on hover)
- Inputs get a subtle violet glow on focus (not just ring — use `box-shadow`)
- Sign-in button: gradient background (`violet-600 → violet-800`), shimmer on hover
- Background: subtle radial gradient from center (barely perceptible — `#0A0A0A` → `#050505` at edges)
- Add a small "✨ AI-native productivity" tagline below logo
- Error states: shake animation on the card (subtle, 3-4px)

### 2. DASHBOARD LAYOUT (`app/dashboard/layout.tsx` + `Sidebar`, `TopBar`, `MobileNav`)

**Sidebar (`components/layout/Sidebar.tsx`):**
- **Current:** Dark sidebar (`bg-[#0D0D0D]`), violet gradient "PRISM" logo, nav items with 3px left accent border on active.
- **Target:**
  - PRISM logo: animated gradient text (violet → fuchsia → violet), subtle glow
  - Nav items: on hover, slide right 2px + gradient background expanding from left
  - Active nav item: full gradient pill (not just left border — `bg-gradient-to-r from-accent/20 to-transparent` + violet left glow dot)
  - Add nav item icons: slight color shift on active (currently dimmed, make them `text-accent`)
  - Badge counts (Learn/Reminders): pulsating dot + count in a rounded pill
  - User avatar at bottom: add a subtle ring glow
  - Smooth sidebar collapse/expand on mobile (currently hidden below md, MobileNav takes over)

**TopBar (`components/layout/TopBar.tsx`):**
- **Current:** Sticky, backdrop-blur, IST date+clock, bell icon with reminder dot, avatar dropdown.
- **Target:**
  - Backdrop blur: increase to `backdrop-blur-xl` for glass feel
  - Date+clock pill: add subtle gradient border on hover
  - Bell icon: bounce animation when `hasSoonReminder` becomes true
  - Page title: gradient text for the current page name (matches sidebar logo style)
  - Add a subtle bottom shadow when scrolled (currently has border only)

**MobileNav (`components/layout/MobileNav.tsx`):**
- **Target:** Glass-morphism bar (backdrop-blur + bg-background/80), active item gets violet glow dot above icon

### 3. DASHBOARD HOME (`app/dashboard/page.tsx`)

**Current:** Greeting header, MoodWidget, 4 stat cards in 2×2/4×1 grid, Due Today list, Upcoming countdown+reminder cards.

**Fable 5 target — complete visual overhaul:**

**Hero greeting:**
- Large gradient text: "Good morning, Udit" (violet → fuchsia)
- Date subtitle below: smaller, muted, IST-formatted
- Add a subtle animated gradient underline that extends on load

**Stat cards (4):**
- **Due Today:** Replace static number with an animated count-up on mount. Card has a subtle violet pulse ring when count > 0.
- **Done This Week:** Keep SVG sparkline but change stroke to violet gradient. Number gets gradient text when > 0 (violet → emerald).
- **Cards to Review:** Animated brain icon (subtle rotate/pulse) when count > 0. Card gets amber accent when due now.
- **Reminders Today:** Bell icon rings (CSS keyframe tilt) when count > 0.
- All cards: on hover, subtle scale (1.01) + gradient border appears (border transitions from `border-border` to `border-accent/30`). Glass morphism on hover (bg shifts slightly lighter).

**Due Today section:**
- Section header: violet accent bar (keep) + gradient text title
- Empty state: currently "All clear for today" with coffee icon — add a subtle confetti-like particle animation (CSS only, small violet dots floating up)
- Task rows: staggered fade-in on mount (animation-delay per index). Swipe-to-complete gets a satisfying green pulse + checkmark scale animation.
- "View all →" link: arrow slides right on hover

**Upcoming section:**
- Countdown cards: progress bar gets gradient fill (violet → amber based on urgency). Emoji scales up slightly on hover.
- Reminder cards: bell icon gets a glow ring when reminder is within 1 hour.
- Cards slide in from right with stagger on mount.

**MoodWidget:**
- Mood emoji buttons get a scale + glow animation on select
- Selected mood gets a violet ring + subtle background pulse

### 4. TASKS PAGE (`app/dashboard/tasks/page.tsx`)

**Current:** PageHeader, filter tabs (All/Todo/In Progress/Done with counts), TaskList.

**Fable 5 target:**
- **Filter tabs:** Active tab gets a gradient underline (instead of solid). Tab counts get animated number transitions.
- **Task cards (`TaskCard.tsx`):** 
  - Checkbox: custom styled — empty circle → filled gradient checkmark with scale animation
  - Priority dots: glow effect (high = red glow, medium = amber glow)
  - Due date chip: color-coded (overdue = red pulse, today = violet, future = muted)
  - Swipe-to-complete: add a green gradient reveal behind the card
  - On hover: subtle lift (translateY(-2px)) + shadow increase
  - Recurring task indicator: animated loop icon (subtle spin)
- **TaskForm modal:** 
  - Slide up from bottom on mobile (sheet style)
  - Gradient submit button
  - Category/duration chips with hover glow
- **Empty states:** Custom SVG illustrations (already have `EmptyTasks` — upgrade the SVG to match new design)

### 5. NOTES PAGE (`app/dashboard/notes/page.tsx`)

**Current:** Search bar, note cards grid, tag chips.

**Fable 5 target:**
- **Search bar:** Animated focus state — border glows violet, icon shifts color. Clear button (X) fades in.
- **Note cards (`NoteCard.tsx`):**
  - Card gets a subtle gradient border on hover (violet edge glow)
  - Tag chips: deterministic colors (already implemented via `lib/tag-colors.ts`) — add subtle glow
  - Markdown preview text: first line gets slightly larger + font-medium
  - Card entrance: staggered fade-up on mount
- **NoteModal (`NoteModal.tsx`):**
  - Write/Preview tabs: active tab gets gradient underline
  - Textarea: monospace font (JetBrains Mono), subtle violet caret
  - "Generate Flashcards" button: sparkle icon + gradient background
- **PDF upload / YouTube import modals:** Glow border on drop zones, animated upload progress (pulsing violet ring)

### 6. PLANS PAGE (`app/dashboard/plans/page.tsx`)

**Target:**
- Plan cards: progress bar gets gradient fill (violet → emerald based on completion %)
- Plan title: strike-through animation on 100% complete
- Task count badge: animated number on change
- Create plan button: gradient

### 7. REMINDERS PAGE (`app/dashboard/reminders/page.tsx`)

**Target:**
- Reminder cards: time-based color coding (upcoming = violet glow, overdue = red pulse, far future = muted)
- Bell icon: subtle tilt animation on pending reminders
- Create reminder form: time picker with violet accent

### 8. CALENDAR PAGE (`app/dashboard/calendar/page.tsx`)

**Target:**
- Calendar grid: today's cell has a violet gradient ring (not just bold). Days with tasks get a subtle violet dot indicator.
- Month navigation: arrows animate on hover. Month title in gradient text.
- Task/reminder dots: color-coded by type
- Selected day: gradient pill background

### 9. FOCUS TIMER PAGE (`app/dashboard/focus/page.tsx`)

**Current:** 3 states — IdleView (category/duration picker), RunningView (SVG ring countdown or stopwatch), CompletedView.

**Fable 5 target — the most visual-impact page:**

**IdleView:**
- Category pills: selected gets gradient background (`bg-gradient-to-r from-accent to-accent-hover`) + slight glow
- Duration buttons: selected gets the same gradient treatment
- Pomodoro/Stopwatch toggle: sliding pill indicator (animated background position change)
- "Start" button: large, full-width, gradient + shimmer effect. Pulsing ring around it (breathing animation)

**RunningView (Pomodoro mode):**
- SVG ring: replace basic ring with a gradient stroke (violet → amber as time decreases). Add a subtle glow filter behind the ring.
- Timer numbers: gradient text (violet when full, trending to amber then red as time runs out). Add text-shadow glow.
- Pause/Stop buttons: glass-morphism pills
- Add particle effects: small violet dots orbit the ring slowly

**RunningView (Stopwatch mode):**
- Keep pulsing ring but make it more pronounced. Add a subtle rotating gradient border (conic-gradient).
- Timer numbers: gradient text with pulsing glow
- Add a "lap" feature indicator (if implemented later)

**CompletedView:**
- Confetti-like celebration (CSS-only particle burst from center)
- Session stats: animated count-up numbers
- "Great job!" with gradient text
- Streak counter if applicable

**FloatingTimer (`components/focus/FloatingTimer.tsx`):**
- Mini timer pill that follows across navigation: glass-morphism, subtle violet pulse when running
- Expand animation when clicked

### 10. LEARN PAGE (`app/dashboard/learn/page.tsx`) + SRS COMPONENTS

**LearnClient:**
- Stats banner: same treatment as dashboard stats (animated numbers, gradient accents)
- "Review All Due" button: gradient + pulse animation when due count > 0
- Deck cards: gradient border on hover, due count badge with glow
- Streak counter: flame icon with CSS fire animation (flicker + color shift), number in gradient text
- Freeze indicator: shield icon with ice-blue glow, count in gradient

**Review Session (`app/dashboard/learn/review/page.tsx`):**
- Progress bar: gradient fill (violet → emerald as cards are reviewed)
- Card counter: animated number transition
- FlashCard: KEEP the CSS 3D flip. Add a subtle glow ring on the back face (accent border already exists). Add a particle burst on flip (tiny violet dots that fade out — CSS only).
- Rating buttons (Again/Hard/Good/Easy): 
  - Again: red glow on hover
  - Hard: amber glow
  - Good: emerald glow  
  - Easy: violet glow
  - Button press: scale down + bounce back (spring easing)
  - Keyboard hint badges: subtle pulse
- Session complete: confetti burst, animated stats counter, gradient "Session complete!" title

**FlashCard (`components/srs/FlashCard.tsx`):**
- Keep existing structure. Add: subtle animated border on the card edge (conic-gradient rotation on hover). Question face gets a subtle particle field (static CSS dots). Answer face gets an accent glow ring.

### 11. REVIEW/WEEKLY PAGE (`app/dashboard/review/page.tsx`)

**Target:**
- Weekly digest cards with animated entry (slide up + fade)
- Best/quietest day highlights with gradient accents
- Productivity trend: Recharts line chart with gradient fill under the line
- Day-of-week bars: gradient fill, hover glow

### 12. SETTINGS PAGE (`app/dashboard/settings/page.tsx`)

**Target:**
- Theme color picker: 6 color swatches with glow on selected, smooth color transition on body
- Notification toggles: custom styled switches (already shadcn Switch — keep but add violet accent)
- Profile section: avatar with gradient ring

### 13. ANALYTICS PANELS

**ProductivityPanel:**
- Recharts charts with gradient fills (not flat colors)
- Grid lines: softer (border-border instead of default gray)
- Tooltips: glass-morphism background
- Animated transitions between time ranges

**AnalyticsPanel (SRS):**
- Mastery distribution: gradient donut chart
- Review activity: gradient area chart
- Per-deck performance: horizontal bars with gradient fill + glow on hover

---

## GLOBAL POLISH

### Animations & Motion (add to `globals.css` or `tailwind.config.ts`)

```
Page entrance: fade + slide-up (200ms, staggered for children)
List items: staggered fade-up (50ms delay per item)
Card hover: scale(1.01) + shadow increase (200ms spring)
Button press: scale(0.97) + release bounce
Modal open: scale(0.95 → 1) + fade (200ms spring)
Toast: slide in from top-right + fade
Number changes: CSS counter animation (if possible) or fade transition
```

### Gradient System (add to `tailwind.config.ts`)

```
accent-gradient: linear-gradient(135deg, #7C3AED, #A78BFA)
accent-gradient-hover: linear-gradient(135deg, #6D28D9, #8B5CF6)
success-gradient: linear-gradient(135deg, #10B981, #34D399)
warning-gradient: linear-gradient(135deg, #F59E0B, #FBBF24)
danger-gradient: linear-gradient(135deg, #EF4444, #F87171)
text-gradient: bg-clip-text text-transparent bg-gradient-to-r from-accent to-fuchsia-400
glass-bg: bg-background/60 backdrop-blur-xl border border-border/50
```

### Depth System

```
Layer 0 (background): bg-background (#0A0A0A)
Layer 1 (cards): bg-surface (#111) + border-border
Layer 2 (raised cards on hover): bg-surface-raised (#1A1A1A) + border-accent/20
Layer 3 (modals/overlays): bg-surface + shadow-2xl + backdrop-blur
```

Add a subtle radial gradient to the main background:
```css
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background: radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.03) 0%, transparent 60%);
  pointer-events: none;
  z-index: 0;
}
```

### Micro-interactions

- **Success actions** (task complete, session done, card reviewed): brief green pulse + subtle scale
- **Error states**: shake animation (3-4px horizontal, 300ms)
- **Loading**: skeleton shimmer with violet tint (not gray)
- **Empty states**: subtle floating animation on the illustration
- **Toast notifications**: glass-morphism, gradient left border

---

## COMPONENT INVENTORY TO REDESIGN (60+ components)

### UI Primitives (in `components/ui/`):
- button.tsx — gradient variant, shimmer, size→scale animation
- badge.tsx — glow on colored variants
- card.tsx — glass on hover, depth layers
- input.tsx — glow focus state
- dialog.tsx — spring open animation, glass backdrop
- tabs.tsx — gradient underline on active
- select.tsx — glow dropdown
- switch.tsx — already themed, keep but add subtle glow on checked
- skeleton.tsx — violet-tinted shimmer
- separator.tsx — gradient variant (violet → transparent)

### Layout:
- Sidebar.tsx — gradient logo, pill-style active nav, glow badges
- TopBar.tsx — glass morphism, animated clock, bounce bell
- MobileNav.tsx — glass bar, glow dots
- PageHeader.tsx — gradient title option

### Dashboard:
- DueTodayRow.tsx — staggered entrance, swipe glow
- MoodWidget.tsx — emoji scale animation, glow ring

### Tasks:
- TaskCard.tsx — lift hover, gradient checkbox, glow priority dots
- TaskForm.tsx — slide-up sheet, gradient submit
- TaskList.tsx — staggered list animation
- task-styles.ts — gradient badge variants

### Notes:
- NoteCard.tsx — gradient border hover, glow tags
- NoteModal.tsx — gradient tabs, violet caret
- NoteList.tsx — staggered grid animation

### Plans:
- PlanCard.tsx — gradient progress bar
- PlanForm.tsx — same treatment as TaskForm
- PlanList.tsx — staggered animation

### SRS / Learn:
- FlashCard.tsx — KEEP 3D flip, add glow ring + particles
- DeckCard.tsx — gradient border hover
- RatingButtons.tsx — color-coded glows, spring press
- LearnClient.tsx — animated stats, gradient CTA
- GenerateCardsModal.tsx — gradient button, sparkle animation
- CardForm.tsx — slide-up sheet
- AnalyticsPanel.tsx — gradient Recharts fills

### Focus:
- FloatingTimer.tsx — glass pill, pulse animation
- ManageCategoriesModal.tsx — same as other modals
- category-colors.ts — already has 12 colors, good

### Shared:
- EmptyState.tsx — floating illustration, gradient CTA
- EmptyStates.tsx — upgrade SVG illustrations
- LoadingSkeleton.tsx — violet shimmer

### Modals (PDF, YouTube):
- PDFUploadModal.tsx — glow dropzone
- YouTubeImportModal.tsx — glow input, animated progress
- YouTubeAnalyzer.tsx — same treatment

### PWA:
- InstallPrompt.tsx — glass card, gradient CTA

---

## ORDER OF EXECUTION (priority)

1. **globals.css + tailwind.config.ts** — gradient system, animations, depth tokens, background vignette
2. **UI primitives** (button, card, input, dialog, tabs, badge, skeleton) — everything builds on these
3. **Layout** (Sidebar, TopBar, MobileNav) — shell sets the tone
4. **Dashboard home** — highest visibility page
5. **Learn + SRS** (FlashCard, RatingButtons, Review session) — the hero feature
6. **Focus timer** — highest visual impact potential
7. **Tasks page** — most-used page
8. **Notes + Plans**
9. **Reminders + Calendar**
10. **Review + Settings**
11. **Modals + empty states**
12. **PWA components**

---

## WHAT NOT TO TOUCH

- **Do NOT change any API routes** (`app/api/*`)
- **Do NOT change any hooks** (`hooks/*`)
- **Do NOT change lib files** (date.ts, sm2.ts, markdown.ts, supabase/*, pdf/*, ai/*)
- **Do NOT change types/database.ts** or **supabase/schema.sql**
- **Do NOT change store files** (Zustand) unless needed for animation state
- **Do NOT change middleware.ts, next.config.mjs, tsconfig**
- **Do NOT change the CSS 3D card flip classes** (`.card-scene`, `.card-3d`, `.card-face`) — only enhance
- **Do NOT upgrade package versions** (stay on React 18, Next 14, Tailwind 3, shadcn v2)
- **Do NOT change between Server/Client Components** — dashboard is a Server Component, don't make it client-side
- **Do NOT add new npm dependencies** unless absolutely necessary for a specific animation (keep it CSS + Tailwind where possible)
