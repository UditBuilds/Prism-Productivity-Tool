# Prism Landing Page v2

Rebuild the landing page at `/`. The current version is too flat and minimal. We want visual depth, product-forward design, and premium SaaS energy. Reference: remnote.com (product screenshots everywhere, alternating layouts, strong social proof), 21st.dev components (Aurora Background, Display Cards, Animated Glassy Pricing).

## Core Rules
- Dark mode, violet accent (#7C3AED), the existing design tokens in globals.css
- Replace `components/landing/LandingPage.tsx` entirely
- Server Component where possible — no client JS beyond the shared bundle
- Remove my name from the footer ("Built by Udit Kumar" → "Prism" brand only)
- One CTA: "Start free" → /signup, repeated on every section
- Keep the `/` route logic: signed-in users → /dashboard, visitors → landing page

## Sections to Build

**1. Nav** — PRISM logo left, "Sign in" + "Start free" right. Sticky, backdrop-blur.

**2. Hero** — Aurora/shader animated background (reference: 21st.dev Aurora Background by Aceternity, 3.2k likes). Headline: "Remember everything you learn." with gradient keyword. Subhead: "AI-powered spaced repetition meets your productivity system. Notes, tasks, and flashcards in one place." Two CTAs: "Start free" (gradient) + "See how it works" (outline). Right side: the CSS dashboard mockup from v1 but with a Glowing Effect treatment (21st.dev, 3.6k) — it should look premium, not flat.

**3. Trust bar** — Thin strip with "Open source" + GitHub stars count + "Built with Next.js, TypeScript, and Supabase" in muted text. No fake logos. No fake numbers.

**4. Features** — Alternating left/right layout with product screenshots. Each section has: heading, 2-3 bullet points, a screenshot mockup, and a "Start free" link. Three sections:
- "Drop content in. Flashcards come out." (PDF/YouTube/notes → AI generates cards)
- "Review when it matters." (SM-2 algorithm, 4-grade ratings, streak tracking)
- "Everything in one place." (Tasks, notes, plans, focus timer — all integrated)

**5. Pricing** — Two cards side by side. Reference: 21st.dev Animated Glassy Pricing (771 likes). Glass-morphism cards with glow border. Free ($0) and Pro ($8/month). "Start free" on both.

**6. Tech stack** — One line: "Open source. Next.js 14, TypeScript, Supabase, Groq LLaMA 3.3 70B." Link to GitHub.

**7. Footer** — Minimal. PRISM logo. GitHub + X + Email links. No personal name. Just the brand.

## Design Quality Targets
- Visual depth: subtle animated backgrounds, glow effects on the mockup, glass on pricing
- Typography: Inter, tight tracking on headings, muted-foreground on descriptions
- Spacing: generous vertical rhythm between sections (py-24 or more)
- No fake testimonials, no fake logos, no particle spam, no animated counters
- The dashboard mockup should look like a real product screenshot

## Verification
tsc + lint + build green. Page must serve 200 at / for unauthenticated users.
