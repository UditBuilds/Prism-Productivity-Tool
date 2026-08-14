"use client";

import { useEffect, useMemo, useRef } from "react";
import { useIsRestoring, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import dynamic from "next/dynamic";
import toast from "react-hot-toast";
import { Plus, Upload, Brain, Layers, Flame, CalendarClock, AlertCircle } from "lucide-react";

import { istDayContext } from "@/lib/date";
import { useAllCards, useDeckStats, useAnalytics } from "@/hooks/useSRS";
import { useNotesQuery } from "@/hooks/useNotes";
import { useUIStore } from "@/store/ui.store";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { EmptyCards } from "@/components/shared/EmptyStates";
import { DeckCard } from "@/components/srs/DeckCard";
import { CardForm } from "@/components/srs/CardForm";
import { ManageDeckModal } from "@/components/srs/ManageDeckModal";
import { YoutubeAnalyzer } from "@/components/learn/YoutubeAnalyzer";
import { PDFUploadModal } from "@/components/pdf/PDFUploadModal";

// Lazy-load the analytics panel so recharts only ships when the Analytics tab
// is opened (keeps the Learn page's initial bundle lean).
const AnalyticsPanel = dynamic(
  () => import("@/components/srs/AnalyticsPanel").then((m) => m.AnalyticsPanel),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-8">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-surface p-4"
            >
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="mt-2 h-7 w-12" />
            </div>
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    ),
  }
);

/**
 * Placeholder sized to the md StatCard value line (text-2xl → 32px) so the
 * banner can't jump. A <span>, not the shared <Skeleton> div: StatCard renders
 * `value` inside a <p>, and a div there is invalid nesting — the browser
 * reparents it and the hydration mismatch comes straight back.
 */
function StatFigureSkeleton() {
  return (
    <span className="skeleton-shimmer inline-block h-8 w-10 rounded-md bg-primary/10 align-middle" />
  );
}

export function LearnClient({ streak }: { streak: number }) {
  const qc = useQueryClient();
  const openCreateCard = useUIStore((s) => s.openCreateCard);
  const openPdfModal = useUIStore((s) => s.openPdfModal);
  const { data: cards, isLoading, isError, refetch } = useAllCards();
  const { data: decks } = useDeckStats();
  const { data: notes } = useNotesQuery();

  // ["srs-cards"] (the banner figures + the deck list) and ["notes"] (the deck
  // "From: <note>" chip) are both persisted, and their IndexedDB snapshots land
  // at an unpredictable point relative to hydration. isLoading reads false for
  // the whole restore because no fetch happens, which is why gating on it never
  // fixed this; isRestoring is true on the server render and the first client
  // render alike. The streak card below is NOT gated — its value comes from a
  // server prop and the non-persisted ["srs-analytics"] query, so it cannot
  // mismatch and there is no reason to hide a number we already have.
  const restoring = useIsRestoring() || isLoading;

  const noteTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const note of notes ?? []) map.set(note.id, note.title);
    return map;
  }, [notes]);

  const { total, dueToday, dueNow } = useMemo(() => {
    const list = cards ?? [];
    const now = Date.now();
    const endToday = Date.parse(istDayContext().endOfToday);
    let dueTodayCount = 0;
    let dueNowCount = 0;
    for (const card of list) {
      const at = new Date(card.next_review).getTime();
      if (at <= endToday) dueTodayCount += 1;
      if (at <= now) dueNowCount += 1;
    }
    return { total: list.length, dueToday: dueTodayCount, dueNow: dueNowCount };
  }, [cards]);

  // The analytics route is the freeze-aware source of truth for the streak +
  // remaining freezes; the server prop is the no-flash fallback until it loads.
  const { data: analytics } = useAnalytics();
  const streakValue = analytics?.streak ?? streak;
  const streakFreezes = analytics?.streak_freezes;

  // "Streak protected" toast — fire once per page load when a freeze was used.
  const freezeToastShown = useRef(false);
  useEffect(() => {
    if (analytics?.freeze_applied && !freezeToastShown.current) {
      freezeToastShown.current = true;
      const remaining = analytics.streak_freezes;
      toast(
        <div className="text-sm">
          <p className="font-semibold text-foreground">Streak protected 🛡️</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Yesterday&apos;s gap was covered by a freeze. {remaining} freeze
            {remaining === 1 ? "" : "s"} remaining this week.
          </p>
        </div>,
        { duration: 6000 }
      );
    }
  }, [analytics?.freeze_applied, analytics?.streak_freezes]);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Learn"
        subtitle="Spaced repetition system"
        icon={Brain}
        actions={
          <>
            <Button
              variant="ghost"
              onClick={openPdfModal}
              className="rounded-lg"
            >
              <Upload className="mr-1.5 h-4 w-4" />
              <span className="hidden sm:inline">Upload PDF</span>
              <span className="sm:hidden">PDF</span>
            </Button>
            <Button onClick={openCreateCard} className="rounded-lg">
              <Plus className="mr-1.5 h-4 w-4" />
              Add Card
            </Button>
          </>
        }
      />

      <Tabs defaultValue="decks" className="mt-4">
        <TabsList className="grid w-full max-w-xs grid-cols-2">
          <TabsTrigger value="decks">Decks</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="decks">
      {/* Stats banner */}
      <section className="stagger-children mt-4 grid grid-cols-3 gap-2">
        {/* The card chrome and label stay put; only the FIGURE waits. A
            skeleton the height of the md value line (text-2xl → 32px) keeps
            the three-column banner exactly the size it will settle at. */}
        <StatCard
          label="Total Cards"
          value={restoring ? <StatFigureSkeleton /> : total}
          icon={Layers}
          size="md"
        />
        <StatCard
          label="Due Today"
          value={restoring ? <StatFigureSkeleton /> : dueToday}
          icon={CalendarClock}
          size="md"
        />
        <StatCard
          label="Streak"
          value={streakValue === 1 ? "1 day" : `${streakValue} days`}
          icon={Flame}
          size="md"
          valueVariant={streakValue > 0 ? "gradient" : "default"}
          iconClassName={
            streakValue > 0
              ? "animate-flicker text-warning drop-shadow-[0_0_6px_hsl(var(--warning)/0.55)]"
              : undefined
          }
          subtitle={
            streakFreezes !== undefined && streakFreezes < 3 ? (
              <p
                className={`mt-2 text-xs ${
                  streakFreezes === 0
                    ? "text-destructive"
                    : "text-accent-soft/90 drop-shadow-[0_0_5px_rgb(var(--accent-soft-rgb)/0.4)]"
                }`}
              >
                🛡️{" "}
                {streakFreezes === 0
                  ? "0 freezes"
                  : `${streakFreezes} freeze left`}
              </p>
            ) : undefined
          }
        />
      </section>

      {/* Review All Due — hidden during restore for the same reason the
          figures are: it appears or not purely on ["srs-cards"]. */}
      {!restoring && dueNow > 0 && (
        <Link href="/dashboard/learn/review" className="mt-4 block">
          <Button className="w-full animate-pulse-ring rounded-lg" size="lg">
            <Brain className="mr-2 h-4 w-4" />
            Review All Due ({dueNow} card{dueNow === 1 ? "" : "s"})
          </Button>
        </Link>
      )}

      {/* Generate from a YouTube video */}
      <div className="mt-8">
        <YoutubeAnalyzer
          onSuccess={() =>
            qc.invalidateQueries({ queryKey: ["srs-cards"] })
          }
        />
      </div>

      {/* Deck list */}
      <div className="mt-8">
        <SectionHeader title="Decks" />
        {restoring ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-surface p-4"
              >
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="mt-2 h-3 w-1/2" />
                <Skeleton className="mt-4 h-1.5 w-full rounded-full" />
                <Skeleton className="mt-4 h-9 w-full rounded-lg" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={AlertCircle}
            title="Couldn't load cards"
            description="Something went wrong fetching your flashcards."
            action={
              <Button variant="outline" onClick={() => refetch()}>
                Try again
              </Button>
            }
          />
        ) : (decks?.length ?? 0) === 0 ? (
          <EmptyCards
            action={
              <Button onClick={openCreateCard} className="rounded-lg">
                <Plus className="mr-1.5 h-4 w-4" />
                Add Card
              </Button>
            }
          />
        ) : (
          <div className="stagger-children grid grid-cols-1 gap-2 sm:grid-cols-2">
            {decks?.map((deck) => (
              <DeckCard
                key={deck.deckName}
                deck={deck}
                sourceNoteTitle={
                  deck.noteId ? noteTitleById.get(deck.noteId) : undefined
                }
              />
            ))}
          </div>
        )}
      </div>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <AnalyticsPanel streak={streakValue} />
        </TabsContent>
      </Tabs>

      <CardForm />
      <ManageDeckModal />
      <PDFUploadModal />
    </div>
  );
}
