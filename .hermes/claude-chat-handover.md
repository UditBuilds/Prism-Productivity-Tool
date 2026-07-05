# Prism — Current State (July 4, 2026)

You're my Claude Chat assistant. Here's where Prism stands after a 6-session Fable 5 sprint with Hermes. Read this before we discuss anything — we've shipped a lot in 3 days.

## What Prism Is
AI-native productivity + spaced-repetition PWA. Tasks, notes, plans, reminders, calendar, focus timer, countdowns, mood tracking, SM-2 flashcard review, 3 AI flashcard pipelines (Notes → Cards, PDF → Cards, YouTube → Cards), learning/productivity analytics, PWA with web push.

**Stack:** Next.js 14, React 18, TypeScript strict, Tailwind v3, shadcn v2, Supabase, Groq LLaMA 3.3 70B, Recharts, Zustand, TanStack Query v5
**Repo:** C:\dev\prism · GitHub: UditBuilds/Prism-Productivity-Tool
**Live:** prism-productivity-tool.vercel.app
**Users:** 2 (me + Drishti) — 75 SRS cards, 4 decks, real usage data

## What We Shipped (June 28 → July 4)

### Frontend Overhaul
- Full visual redesign: gradient system, glass-morphism, 15+ CSS keyframes, animated PRISM wordmark, themeable accent colors (violet/blue/emerald/amber/rose/cyan)
- 60+ components upgraded: gradient buttons, glow inputs, glass dialogs, gradient tabs, glowing badges, accent-tinted skeleton shimmer
- CSS 3D card flip preserved for flashcards (untouched)

### SaaS Features
- **Landing page v2** at `/` — aurora animated hero, product-forward feature rows with CSS mockups, glassy pricing cards ($0 Free / $8 Pro), 7 "Start free" CTAs, dark mode, zero client JS
- **Onboarding wizard** — 3-step (Welcome → Notifications → Done) after signup, localStorage guard
- **Error boundary** on all pages + offline detection banner
- **Keyboard shortcuts** — `?` modal, `n/t/l/f/d` nav hotkeys
- **Changelog modal** — version-tracked, auto-suppresses for new users
- **Pull-to-refresh, haptic feedback, swipe-to-delete** on reminders with 5s undo

### Bug Fixes
- **Reminder notifications never fired** — root cause: API GET filtered `.gte("remind_at", now)` which deleted due reminders from cache before the 60s checker could fire. Fixed by removing the filter + 3→30min staleTime
- **Notification permission** — was hidden in Settings only. Now: dashboard nudge banner + prompt after creating a reminder
- **Learn badge** — showed "9+" for 75 due cards. Display cap raised to "99+"
- **Onboarding wizard re-appeared** — fixed with useRef session guard

### Landing Page Evolution
- v1: Flat dark card, 2×2 feature grid, centered — too bland
- v2: Animated aurora CSS background, two-column hero, 3 alternating feature rows with product mockups, glassy pricing with accent bloom, personal name removed, "Open source" messaging stripped

## What's Still Open
- Stripe integration (payment + plan gating)
- Email verification on signup
- Deck sharing (public shareable URLs — viral growth)
- Achievement/badge system
- Custom domain (prism.so or similar)
- Some Vercel env vars needed manual setup (GROQ_API_KEY etc.)

## What I Want To Discuss
Prism has real SaaS potential — it's the only tool combining notes, tasks, and AI-powered SM-2 spaced repetition in one premium package. RemNote and Anki are the closest competitors but neither does everything Prism does.

I want to monetize it seriously. Priorities: Stripe integration, email verification, then deck sharing for growth. Fable 5 (my design tool) expires July 7 so I'm maximizing visual/output work until then.

Let's talk about the monetization architecture — how to wire Stripe, plan gating, and what the paid tier actually restricts.
