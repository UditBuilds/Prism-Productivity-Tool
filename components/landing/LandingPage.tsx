import Link from "next/link";
import {
  Brain,
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  Download,
  FileText,
  LayoutGrid,
  ListChecks,
  Mail,
  RefreshCw,
  Sparkles,
  Timer,
} from "lucide-react";

/* Brand marks — this lucide-react version has no Github/Twitter icons. */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.72-1.53-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11.1 11.1 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.66.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function XMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
    </svg>
  );
}

const GITHUB_URL = "https://github.com/UditBuilds/Prism-Productivity-Tool";

/** The one primary action on the page. */
function StartFree({ large = false }: { large?: boolean }) {
  return (
    <Link
      href="/signup"
      className={
        large
          ? "btn-primary-shimmer inline-flex items-center justify-center rounded-xl bg-accent-gradient px-7 py-3 text-sm font-semibold text-white shadow-glow-accent-sm hover:bg-accent-gradient-hover"
          : "inline-flex items-center justify-center rounded-lg bg-accent-gradient px-4 py-2 text-sm font-semibold text-white shadow-glow-accent-sm hover:bg-accent-gradient-hover"
      }
    >
      Start free
    </Link>
  );
}

/* ── Top nav ─────────────────────────────────────────────────────── */

function TopNav() {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
      <span className="text-gradient-animated text-lg font-bold tracking-tight">
        PRISM
      </span>
      <nav className="flex items-center gap-5">
        <Link
          href="/login"
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Sign in
        </Link>
        <StartFree />
      </nav>
    </header>
  );
}

/* ── Hero ────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="mx-auto max-w-5xl px-6 pb-20 pt-14 text-center sm:pt-20">
      <h1 className="animate-fade-up text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
        Remember everything
        <br />
        <span className="text-gradient">you learn.</span>
      </h1>
      <p className="mx-auto mt-5 max-w-2xl animate-fade-up text-base leading-relaxed text-muted-foreground [animation-delay:100ms] sm:text-lg">
        Prism combines tasks, notes, and AI-powered spaced repetition into one
        tool. Drop in a PDF, a YouTube link, or your own notes — we turn them
        into flashcards that show up exactly when you&apos;re about to forget.
      </p>
      <div className="mt-8 flex animate-fade-up items-center justify-center gap-3 [animation-delay:200ms]">
        <StartFree large />
        <a
          href="#features"
          className="inline-flex items-center justify-center rounded-xl border border-border bg-surface px-7 py-3 text-sm font-medium text-foreground hover:border-accent/30 hover:bg-surface-raised"
        >
          See how it works
        </a>
      </div>

      <DashboardMockup />
    </section>
  );
}

/**
 * Lightweight CSS mockup of the Prism dashboard — looks like a screenshot,
 * costs nothing to load. Purely decorative.
 */
function DashboardMockup() {
  return (
    <div
      aria-hidden
      className="pointer-events-none mx-auto mt-14 max-w-4xl select-none animate-fade-up text-left [animation-delay:300ms]"
    >
      <div className="gradient-border overflow-hidden rounded-2xl shadow-2xl shadow-black/60 [--gb-bg:#0C0C0C]">
        {/* Window chrome */}
        <div className="flex items-center gap-1.5 border-b border-border/60 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#2A2A2A]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#2A2A2A]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#2A2A2A]" />
          <span className="ml-3 rounded-md bg-surface-raised/60 px-2 py-0.5 text-[10px] text-muted-foreground/60">
            prism.app/dashboard
          </span>
        </div>

        <div className="flex">
          {/* Sidebar */}
          <div className="hidden w-40 shrink-0 border-r border-border/60 bg-[#0D0D0D] p-3 sm:block">
            <p className="text-gradient px-2 text-sm font-bold">PRISM</p>
            <div className="mt-3 space-y-1">
              <div className="flex items-center gap-2 rounded-md bg-[linear-gradient(to_right,rgb(var(--accent-rgb)/0.18),transparent)] px-2 py-1.5 text-[11px] font-medium text-accent">
                <LayoutGrid className="h-3 w-3" /> Dashboard
              </div>
              {[
                { icon: ListChecks, label: "Tasks" },
                { icon: FileText, label: "Notes" },
                { icon: Timer, label: "Focus" },
              ].map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-muted-foreground"
                >
                  <Icon className="h-3 w-3" /> {label}
                </div>
              ))}
              <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-muted-foreground">
                <Brain className="h-3 w-3" /> Learn
                <span className="ml-auto rounded-full bg-accent px-1.5 text-[9px] font-bold text-white">
                  45
                </span>
              </div>
            </div>
          </div>

          {/* Main panel */}
          <div className="min-w-0 flex-1 bg-[#0A0A0A] p-4 sm:p-5">
            <p className="text-sm font-bold text-foreground">
              Good morning, <span className="text-gradient">Udit</span>
            </p>

            {/* Stat cards */}
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { label: "DUE TODAY", value: "3", icon: CalendarClock },
                { label: "DONE THIS WEEK", value: "12", icon: CheckCircle2 },
                { label: "CARDS TO REVIEW", value: "45", icon: Brain },
              ].map(({ label, value, icon: Icon }) => (
                <div
                  key={label}
                  className="rounded-lg border border-border bg-surface p-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate text-[8px] font-medium tracking-widest text-muted-foreground">
                      {label}
                    </span>
                    <Icon className="h-3 w-3 shrink-0 text-accent/60" />
                  </div>
                  <p className="mt-1 text-lg font-bold tabular-nums text-white">
                    {value}
                  </p>
                </div>
              ))}
            </div>

            {/* Task list + flashcard */}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                {[
                  { title: "Review SM-2 scheduling notes", done: true },
                  { title: "Finish physics problem set", done: false },
                  { title: "30-min focus: deep work", done: false },
                ].map((t) => (
                  <div
                    key={t.title}
                    className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2"
                  >
                    {t.done ? (
                      <CheckCircle2 className="h-3 w-3 shrink-0 text-success" />
                    ) : (
                      <Circle className="h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                    <span
                      className={
                        t.done
                          ? "truncate text-[10px] text-muted-foreground line-through"
                          : "truncate text-[10px] text-foreground"
                      }
                    >
                      {t.title}
                    </span>
                  </div>
                ))}
              </div>

              {/* Flashcard */}
              <div className="rounded-lg border border-accent/25 bg-gradient-to-b from-surface-raised to-surface p-3 ring-1 ring-inset ring-accent/10">
                <p className="text-[8px] font-medium uppercase tracking-[0.18em] text-accent/70">
                  Question
                </p>
                <p className="mt-1.5 text-[11px] font-medium text-foreground">
                  What is SM-2?
                </p>
                <div className="my-2 h-px bg-border/60" />
                <p className="text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
                  Answer
                </p>
                <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                  An algorithm that spaces reviews at optimal intervals for
                  memory retention.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Features ────────────────────────────────────────────────────── */

const FEATURES = [
  {
    icon: Sparkles,
    title: "AI-Generated Flashcards",
    text: "Drop in a PDF, paste a YouTube link, or write a note. Prism's AI reads it and generates Q&A flashcards automatically. Not generic summaries — actual question-answer pairs tuned for recall.",
    detail: "3 AI pipelines: Notes → Cards · PDF → Cards · YouTube → Cards",
  },
  {
    icon: RefreshCw,
    title: "Spaced Repetition That Works",
    text: "Not a toy algorithm. Real SM-2 scheduling with 4-grade ratings (Again/Hard/Good/Easy). Cards come back exactly when research says you need to see them. Streak tracking with freeze protection keeps you honest.",
    detail: "SM-2 algorithm · 4-grade review flow · 3 freezes/week",
  },
  {
    icon: LayoutGrid,
    title: "Everything in One Place",
    text: "Tasks, notes, plans, reminders, calendar, and focus timer — built into the same app as your flashcards. No switching between 5 tools. Your study sessions and your to-do list live together.",
    detail: "Tasks · Notes · Plans · Reminders · Calendar · Focus timer",
  },
  {
    icon: Download,
    title: "Install It. It Works Offline.",
    text: "Prism is a PWA — install it on your phone or desktop. Works offline. Push notifications remind you about reviews and tasks. Feels native, not like a website.",
    detail: "PWA · Offline support · Push notifications · iOS + Android",
  },
];

function Features() {
  return (
    <section id="features" className="mx-auto max-w-5xl scroll-mt-16 px-6 py-16">
      <h2 className="text-center text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        What&apos;s actually in it
      </h2>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {FEATURES.map(({ icon: Icon, title, text, detail }) => (
          <div
            key={title}
            className="rounded-xl border border-border bg-surface p-6 transition-colors hover:border-accent/25"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/20 bg-accent/10">
              <Icon className="h-5 w-5 text-accent" aria-hidden />
            </div>
            <h3 className="mt-4 text-base font-semibold text-foreground">
              {title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {text}
            </p>
            <p className="mt-4 font-mono text-xs text-muted-foreground/60">
              {detail}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── How it works ────────────────────────────────────────────────── */

const STEPS = [
  {
    step: "1",
    title: "Add content",
    text: "Write a note, upload a PDF, or paste a YouTube link. Your knowledge, captured.",
  },
  {
    step: "2",
    title: "AI generates cards",
    text: "Prism reads your content and creates Q&A flashcards. Review them, edit them, organize them into decks.",
  },
  {
    step: "3",
    title: "Review on schedule",
    text: "Cards come back when you're about to forget. Rate your recall. The algorithm handles the rest.",
  },
];

function HowItWorks() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="text-center text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        How it works
      </h2>
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {STEPS.map(({ step, title, text }) => (
          <div
            key={step}
            className="rounded-xl border border-border bg-surface p-6"
          >
            <span className="text-gradient font-mono text-2xl font-bold">
              {step}
            </span>
            <h3 className="mt-3 text-base font-semibold text-foreground">
              {title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {text}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Pricing ─────────────────────────────────────────────────────── */

const FREE_FEATURES = [
  "5 AI generations per month",
  "3 decks",
  "All productivity features (tasks, notes, plans, focus timer)",
  "Basic analytics",
  "PWA install",
];

const PRO_FEATURES = [
  "Unlimited AI generations",
  "Unlimited decks",
  "Advanced analytics",
  "Priority support",
  "Custom accent themes",
];

function PricingCard({
  name,
  price,
  period,
  features,
  highlighted = false,
}: {
  name: string;
  price: string;
  period?: string;
  features: string[];
  highlighted?: boolean;
}) {
  return (
    <div
      className={
        highlighted
          ? "gradient-border flex flex-col rounded-2xl p-7"
          : "flex flex-col rounded-2xl border border-border bg-surface p-7"
      }
    >
      <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        {name}
      </h3>
      <p className="mt-3 text-4xl font-bold tracking-tight text-foreground">
        {price}
        {period && (
          <span className="text-base font-normal text-muted-foreground">
            {period}
          </span>
        )}
      </p>
      <ul className="mt-6 flex-1 space-y-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-7">
        <Link
          href="/signup"
          className={
            highlighted
              ? "btn-primary-shimmer flex w-full items-center justify-center rounded-xl bg-accent-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-glow-accent-sm hover:bg-accent-gradient-hover"
              : "flex w-full items-center justify-center rounded-xl border border-border bg-surface-raised px-4 py-2.5 text-sm font-semibold text-foreground hover:border-accent/30"
          }
        >
          Start free
        </Link>
      </div>
    </div>
  );
}

function Pricing() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <h2 className="text-center text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        Pricing
      </h2>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Free to start. One paid tier. No &ldquo;contact sales.&rdquo;
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <PricingCard name="Free" price="$0" features={FREE_FEATURES} />
        <PricingCard
          name="Pro"
          price="$8"
          period="/month"
          features={PRO_FEATURES}
          highlighted
        />
      </div>
    </section>
  );
}

/* ── Tech transparency + footer ──────────────────────────────────── */

function TechStack() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-12 text-center">
      <p className="text-sm text-muted-foreground">
        Built with Next.js 14, TypeScript, Supabase, Groq LLaMA 3.3 70B, and
        Tailwind CSS.{" "}
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-accent underline-offset-4 hover:underline"
        >
          Open source on GitHub
        </a>
        .
      </p>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-gradient text-base font-bold tracking-tight">
            PRISM
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            AI-native spaced repetition
          </p>
        </div>
        <div className="flex items-center gap-4">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className="text-muted-foreground hover:text-foreground"
          >
            <GithubMark className="h-5 w-5" />
          </a>
          <a
            href="https://x.com/UditBuilds"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Twitter / X"
            className="text-muted-foreground hover:text-foreground"
          >
            <XMark className="h-5 w-5" />
          </a>
          <a
            href="mailto:uditkumar7789@gmail.com"
            aria-label="Email"
            className="text-muted-foreground hover:text-foreground"
          >
            <Mail className="h-5 w-5" />
          </a>
        </div>
      </div>
      <div className="border-t border-border/40 py-4 text-center text-xs text-muted-foreground/60">
        Built by Udit Kumar. Delhi, India.
      </div>
    </footer>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Pricing />
        <TechStack />
      </main>
      <Footer />
    </div>
  );
}
