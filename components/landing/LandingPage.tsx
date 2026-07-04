import Link from "next/link";
import {
  Brain,
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  FileText,
  LayoutGrid,
  ListChecks,
  Mail,
  Play,
  Timer,
  Upload,
} from "lucide-react";

const GITHUB_URL = "https://github.com/UditBuilds/Prism-Productivity-Tool";

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

/** The one primary action on the page. */
function StartFree({
  large = false,
  className = "",
}: {
  large?: boolean;
  className?: string;
}) {
  return (
    <Link
      href="/signup"
      className={
        (large
          ? "btn-primary-shimmer inline-flex items-center justify-center rounded-xl bg-accent-gradient px-7 py-3 text-sm font-semibold text-white shadow-glow-accent-sm hover:bg-accent-gradient-hover "
          : "inline-flex items-center justify-center rounded-lg bg-accent-gradient px-4 py-2 text-sm font-semibold text-white shadow-glow-accent-sm hover:bg-accent-gradient-hover ") +
        className
      }
    >
      Start free
    </Link>
  );
}

/* ── Nav ─────────────────────────────────────────────────────────── */

function TopNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
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
      </div>
    </header>
  );
}

/* ── Hero ────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="aurora" aria-hidden />
      <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-14 px-6 pb-24 pt-16 sm:pt-24 lg:grid-cols-2">
        <div className="text-center lg:text-left">
          <h1 className="animate-fade-up text-4xl font-bold tracking-tight text-foreground sm:text-5xl xl:text-6xl">
            Remember <span className="text-gradient">everything</span>
            <br />
            you learn.
          </h1>
          <p className="mx-auto mt-5 max-w-xl animate-fade-up text-base leading-relaxed text-muted-foreground [animation-delay:100ms] sm:text-lg lg:mx-0">
            AI-powered spaced repetition meets your productivity system.
            Notes, tasks, and flashcards in one place.
          </p>
          <div className="mt-8 flex animate-fade-up items-center justify-center gap-3 [animation-delay:200ms] lg:justify-start">
            <StartFree large />
            <a
              href="#features"
              className="inline-flex items-center justify-center rounded-xl border border-border bg-surface/70 px-7 py-3 text-sm font-medium text-foreground backdrop-blur hover:border-accent/30 hover:bg-surface-raised"
            >
              See how it works
            </a>
          </div>
        </div>

        <DashboardMockup />
      </div>
    </section>
  );
}

/**
 * Lightweight CSS mockup of the Prism dashboard with a glow treatment —
 * looks like a product screenshot, costs nothing to load. Purely decorative.
 */
function DashboardMockup() {
  return (
    <div
      aria-hidden
      className="pointer-events-none relative select-none animate-fade-up [animation-delay:300ms]"
    >
      {/* Glow halo behind the shot */}
      <div className="absolute -inset-6 rounded-[2rem] bg-accent/15 blur-3xl" />

      <div className="gradient-border relative overflow-hidden rounded-2xl shadow-2xl shadow-black/60 [--gb-bg:#0C0C0C]">
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
          <div className="hidden w-36 shrink-0 border-r border-border/60 bg-[#0D0D0D] p-3 sm:block">
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

/* ── Trust bar ───────────────────────────────────────────────────── */

function TrustBar({ stars }: { stars: number | null }) {
  return (
    <div className="border-y border-border/40 bg-surface/30">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-6 py-4 text-xs text-muted-foreground">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 font-medium text-foreground/80 hover:text-foreground"
        >
          <GithubMark className="h-3.5 w-3.5" />
          Open source
          {stars !== null && (
            <span className="rounded-full border border-border/70 bg-surface px-1.5 py-0.5 tabular-nums text-muted-foreground">
              ★ {stars}
            </span>
          )}
        </a>
        <span aria-hidden className="hidden text-border sm:inline">
          ·
        </span>
        <span>Built with Next.js, TypeScript, and Supabase</span>
      </div>
    </div>
  );
}

/* ── Feature rows (alternating) ──────────────────────────────────── */

function FeatureRow({
  heading,
  bullets,
  mockup,
  flip = false,
}: {
  heading: string;
  bullets: string[];
  mockup: React.ReactNode;
  flip?: boolean;
}) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={flip ? "lg:order-last" : undefined}>
        <h3 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {heading}
        </h3>
        <ul className="mt-5 space-y-3">
          {bullets.map((b) => (
            <li
              key={b}
              className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground"
            >
              <Check
                className="mt-0.5 h-4 w-4 shrink-0 text-accent"
                aria-hidden
              />
              {b}
            </li>
          ))}
        </ul>
        <Link
          href="/signup"
          className="group mt-6 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:text-accent-hover"
        >
          Start free
          <span
            aria-hidden
            className="transition-transform group-hover:translate-x-0.5"
          >
            →
          </span>
        </Link>
      </div>
      <div className="relative">
        <div
          aria-hidden
          className="absolute -inset-4 rounded-[2rem] bg-accent/10 blur-2xl"
        />
        <div className="relative">{mockup}</div>
      </div>
    </div>
  );
}

/** Mockup: sources in → generated cards out. */
function GenerateMockup() {
  return (
    <div
      aria-hidden
      className="gradient-border pointer-events-none select-none rounded-2xl p-4 [--gb-bg:#0C0C0C]"
    >
      <div className="flex flex-wrap gap-2">
        {[
          { icon: Upload, label: "lecture-notes.pdf" },
          { icon: Play, label: "youtube.com/watch?v=…" },
          { icon: FileText, label: "Note: Memory systems" },
        ].map(({ icon: Icon, label }) => (
          <span
            key={label}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-muted-foreground"
          >
            <Icon className="h-3 w-3 text-accent" />
            {label}
          </span>
        ))}
      </div>
      <p className="my-3 text-center text-xs text-accent">↓</p>
      <div className="space-y-2">
        {[
          {
            q: "What does the spacing effect predict?",
            a: "Reviews spread over time beat massed repetition for retention.",
          },
          {
            q: "Why active recall over re-reading?",
            a: "Retrieving strengthens the memory trace; re-reading only feels fluent.",
          },
        ].map(({ q, a }) => (
          <div
            key={q}
            className="rounded-lg border border-border bg-surface p-3"
          >
            <p className="text-[11px] font-medium text-foreground">Q: {q}</p>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              A: {a}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-[10px] text-muted-foreground/60">
        12 cards generated · review before saving
      </p>
    </div>
  );
}

/** Mockup: flashcard with the 4-grade rating row. */
function ReviewMockup() {
  return (
    <div
      aria-hidden
      className="gradient-border pointer-events-none select-none rounded-2xl p-4 [--gb-bg:#0C0C0C]"
    >
      <div className="rounded-xl border border-accent/25 bg-gradient-to-b from-surface-raised to-surface p-4 ring-1 ring-inset ring-accent/10">
        <p className="text-[8px] font-medium uppercase tracking-[0.18em] text-accent/70">
          Answer
        </p>
        <p className="mt-2 text-sm font-medium leading-relaxed text-foreground">
          Ebbinghaus&apos;s forgetting curve — memory decays exponentially
          unless reviews reset the curve.
        </p>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {[
          { label: "Again", interval: "<1 min", dot: "bg-red-400" },
          { label: "Hard", interval: "1 day", dot: "bg-amber-400" },
          { label: "Good", interval: "4 days", dot: "bg-blue-400" },
          { label: "Easy", interval: "9 days", dot: "bg-emerald-400" },
        ].map(({ label, interval, dot }) => (
          <div
            key={label}
            className="flex flex-col items-center gap-0.5 rounded-lg border border-border bg-surface-raised px-1 py-2"
          >
            <span className="flex items-center gap-1 text-[10px] font-semibold text-foreground">
              <span className={`h-1 w-1 rounded-full ${dot}`} />
              {label}
            </span>
            <span className="text-[8px] tabular-nums text-muted-foreground">
              {interval}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-[10px] text-muted-foreground/60">
        🔥 12-day streak · 🛡️ 2 freezes left this week
      </p>
    </div>
  );
}

/** Mockup: tasks + focus timer living together. */
function WorkspaceMockup() {
  return (
    <div
      aria-hidden
      className="gradient-border pointer-events-none select-none rounded-2xl p-4 [--gb-bg:#0C0C0C]"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1.5">
          {[
            { title: "Draft project plan", done: true },
            { title: "Anatomy deck — 20 cards due", done: false },
            { title: "Call the bank", done: false },
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
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2">
            <CalendarClock className="h-3 w-3 shrink-0 text-amber-400" />
            <span className="truncate text-[10px] text-muted-foreground">
              Reminder: review session · 6:00 PM
            </span>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-surface px-5 py-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-accent/70 text-xs font-bold tabular-nums text-white">
            18:24
          </span>
          <span className="text-[9px] font-medium uppercase tracking-widest text-muted-foreground">
            📚 Study
          </span>
        </div>
      </div>
    </div>
  );
}

function Features() {
  return (
    <section
      id="features"
      className="mx-auto max-w-6xl scroll-mt-16 space-y-24 px-6 py-24"
    >
      <FeatureRow
        heading="Drop content in. Flashcards come out."
        bullets={[
          "Upload a PDF, paste a YouTube link, or write a note — Prism's AI reads it and generates Q&A flashcards automatically.",
          "Real question-answer pairs tuned for recall, not generic summaries.",
          "Every batch is a draft: review, edit, and organize into decks before anything is saved.",
        ]}
        mockup={<GenerateMockup />}
      />
      <FeatureRow
        flip
        heading="Review when it matters."
        bullets={[
          "Real SM-2 scheduling — cards come back exactly when research says you're about to forget.",
          "Four-grade ratings (Again / Hard / Good / Easy) with the next interval shown before you press.",
          "Streak tracking with 3 freezes a week, so one busy day doesn't wipe your progress.",
        ]}
        mockup={<ReviewMockup />}
      />
      <FeatureRow
        heading="Everything in one place."
        bullets={[
          "Tasks, notes, plans, reminders, calendar, and a focus timer — in the same app as your flashcards.",
          "Your study sessions and your to-do list live together. No switching between 5 tools.",
          "Installable PWA with push notifications — works offline, feels native on iOS and Android.",
        ]}
        mockup={<WorkspaceMockup />}
      />
    </section>
  );
}

/* ── Pricing (glass) ─────────────────────────────────────────────── */

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
          ? "gradient-border flex flex-col rounded-2xl p-7 shadow-glow-accent backdrop-blur-xl [--gb-bg:rgb(14_14_14_/_0.72)]"
          : "flex flex-col rounded-2xl border border-border bg-surface/60 p-7 backdrop-blur-xl"
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
          <li
            key={f}
            className="flex items-start gap-2 text-sm text-muted-foreground"
          >
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
    <section className="relative overflow-hidden py-24">
      {/* Accent bloom behind the glass cards so the blur has something real */}
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/20 blur-[110px]"
      />
      <div className="relative mx-auto max-w-3xl px-6">
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
      </div>
    </section>
  );
}

/* ── Tech + footer ───────────────────────────────────────────────── */

function TechStack() {
  return (
    <section className="mx-auto max-w-3xl px-6 pb-24 text-center">
      <p className="text-sm text-muted-foreground">
        Open source. Next.js 14, TypeScript, Supabase, Groq LLaMA 3.3 70B.{" "}
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-accent underline-offset-4 hover:underline"
        >
          View on GitHub
        </a>
        .
      </p>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
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
    </footer>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */

export function LandingPage({ stars }: { stars: number | null }) {
  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main>
        <Hero />
        <TrustBar stars={stars} />
        <Features />
        <Pricing />
        <TechStack />
      </main>
      <Footer />
    </div>
  );
}
