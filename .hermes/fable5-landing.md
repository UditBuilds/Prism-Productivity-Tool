# Fable 5 — Prism Landing Page (Not AI Slop)

> Build a real SaaS landing page that converts. Linear/Vercel quality. No generic AI fluff — every word is specific to Prism's actual features.

**Repo:** C:\dev\prism
**Stack:** Next.js 14, React 18, TypeScript, Tailwind v3, shadcn v2
**Route:** Replace `app/page.tsx` (currently redirects to /dashboard) with the landing page. Authenticated users still redirect to /dashboard — only unauthenticated visitors see the landing page.
**Rules:** No new npm deps unless essential. `tsc + lint + build` green. No Tailwind v4, no shadcn v3.

---

## DESIGN PRINCIPLES

This is NOT an AI-generated slop website. Rules:

1. **No generic illustrations** — use real Prism screenshots (we'll use actual product screenshots, not cartoon people or abstract blobs)
2. **No fake metrics** — don't claim "10,000+ users" or "99.9% uptime"
3. **No buzzwords** — cut "revolutionize," "empower," "next-gen," "cutting-edge," "seamless"
4. **Concrete features** — "SM-2 spaced repetition algorithm" not "smart learning"
5. **Real pricing** — actual numbers, no "contact sales" dark patterns
6. **One CTA** — "Start free" everywhere, not 5 different buttons

---

## SECTION 1: HERO

**Headline:** "Remember everything you learn."

**Subheadline:** "Prism combines tasks, notes, and AI-powered spaced repetition into one tool. Drop in a PDF, a YouTube link, or your own notes — we turn them into flashcards that show up exactly when you're about to forget."

**CTA:** "Start free" → /signup (gradient violet button)
**Secondary:** "See how it works" → scrolls to features

**Visual:** A mockup of the Prism dashboard — not a cartoon, not an illustration. Use a dark card with actual-looking UI: stat cards (Due Today: 3, Done This Week: 12, Cards to Review: 45), a task list, a flashcard showing "Q: What is SM-2?" / "A: An algorithm that spaces reviews at optimal intervals for memory retention." Make it look like a real screenshot, with the sidebar and violet accents.

---

## SECTION 2: FEATURES (4 cards, 2x2 grid)

Use real Prism feature names, not generic fluff:

**Card 1: "AI-Generated Flashcards"**
Icon: Brain/sparkle
Text: "Drop in a PDF, paste a YouTube link, or write a note. Prism's AI reads it and generates Q&A flashcards automatically. Not generic summaries — actual question-answer pairs tuned for recall."
Detail: "3 AI pipelines: Notes → Cards, PDF → Cards, YouTube → Cards"

**Card 2: "Spaced Repetition That Works"**
Icon: Calendar/refresh
Text: "Not a toy algorithm. Real SM-2 scheduling with 4-grade ratings (Again/Hard/Good/Easy). Cards come back exactly when research says you need to see them. Streak tracking with freeze protection keeps you honest."
Detail: "SM-2 algorithm · 4-grade review flow · 3 freezes/week"

**Card 3: "Everything in One Place"**
Icon: Layout/checklist
Text: "Tasks, notes, plans, reminders, calendar, and focus timer — built into the same app as your flashcards. No switching between 5 tools. Your study sessions and your to-do list live together."
Detail: "Tasks · Notes · Plans · Reminders · Calendar · Focus timer"

**Card 4: "Install It. It Works Offline."**
Icon: Download/smartphone
Text: "Prism is a PWA — install it on your phone or desktop. Works offline. Push notifications remind you about reviews and tasks. Feels native, not like a website."
Detail: "PWA · Offline support · Push notifications · iOS + Android"

---

## SECTION 3: HOW IT WORKS (3 steps)

Not a timeline, not a diagram. Three simple cards:

**Step 1: "Add content"**
"Write a note, upload a PDF, or paste a YouTube link. Your knowledge, captured."

**Step 2: "AI generates cards"**
"Prism reads your content and creates Q&A flashcards. Review them, edit them, organize them into decks."

**Step 3: "Review on schedule"**
"Cards come back when you're about to forget. Rate your recall. The algorithm handles the rest."

---

## SECTION 4: PRICING (2 tiers, no dark patterns)

**Free:** $0
- 5 AI generations per month
- 3 decks
- All productivity features (tasks, notes, plans, focus timer)
- Basic analytics
- PWA install

**Pro:** $8/month
- Unlimited AI generations
- Unlimited decks
- Advanced analytics
- Priority support
- Custom accent themes

"Start free" button on both cards — directs to /signup.

---

## SECTION 5: TECH STACK TRANSPARENCY

A small, understated section that builds trust with technical users:

"Built with Next.js 14, TypeScript, Supabase, Groq LLaMA 3.3 70B, Tailwind CSS. Open source on GitHub."

Link to github.com/UditBuilds/Prism-Productivity-Tool

---

## SECTION 6: FOOTER

Minimal. Clean.
- Left: PRISM logo + "AI-native spaced repetition"
- Right: GitHub · Twitter/X · Email
- Bottom: "Built by Udit Kumar. Delhi, India."

---

## TECHNICAL NOTES

### Server Component vs Client
The landing page should be a Server Component where possible. Only the CTA buttons need interactivity (scroll, link). No heavy client JS on the landing page.

### Route handling
```tsx
// app/page.tsx
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { LandingPage } from "@/components/landing/LandingPage";

export default async function Home() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (user) redirect("/dashboard");
  return <LandingPage />;
}
```

Create the landing page as `components/landing/LandingPage.tsx` (Server Component) with sub-components as needed.

### Screenshots / Mockups
For the hero visual, don't use an actual PNG screenshot (slow to load). Instead, build an HTML/CSS mockup of the Prism dashboard that looks real — dark card with realistic stat numbers, a task list, a flashcard. It should look like a product screenshot but be lightweight CSS.

### CTA consistency
Every "Start free" button goes to `/signup`. Only one primary action across the entire page.

### Performance
- No heavy images (use CSS mockup instead of screenshots)
- No animation libraries (use Tailwind `animate-*` only)
- Server Component where possible
- Lighthouse target: 95+ performance, 100 accessibility

---

## ANTI-PATTERNS TO AVOID

These make it look like AI slop. DO NOT include:
- ❌ Gradient backgrounds on every section
- ❌ Animated counters ("5000+ users served!")
- ❌ Testimonial cards with fake names and headshots
- ❌ "Trusted by companies like..." with fake logos
- ❌ Over-animated hero with particles/stars/confetti
- ❌ Multiple conflicting CTAs ("Sign up," "Learn more," "Book a demo," "Contact sales")
- ❌ Buzzwords: revolutionize, empower, cutting-edge, seamless, next-gen
- ❌ Stock photos of people smiling at laptops

---

## VERIFICATION

```bash
cd C:\dev\prism
npx tsc --noEmit
npx next lint
npx next build
```

All green. Landing page must load fast (< 2s). Check that / still redirects authenticated users to /dashboard.
