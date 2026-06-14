"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-surface p-4"
            >
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="mt-3 h-7 w-12" />
            </div>
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    ),
  }
);

export function LearnClient({ streak }: { streak: number }) {
  const qc = useQueryClient();
  const openCreateCard = useUIStore((s) => s.openCreateCard);
  const openPdfModal = useUIStore((s) => s.openPdfModal);
  const { data: cards, isLoading, isError, refetch } = useAllCards();
  const { data: decks } = useDeckStats();
  const { data: notes } = useNotesQuery();

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

  const stats = [
    { label: "Total Cards", value: total, icon: Layers },
    { label: "Due Today", value: dueToday, icon: CalendarClock },
    {
      label: "Streak",
      value: streakValue === 1 ? "1 day" : `${streakValue} days`,
      icon: Flame,
    },
  ];

  return (
    <div>
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

      <Tabs defaultValue="decks" className="mt-5">
        <TabsList className="grid w-full max-w-xs grid-cols-2">
          <TabsTrigger value="decks">Decks</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="decks">
      {/* Stats banner */}
      <section className="mt-5 grid grid-cols-3 gap-3">
        {stats.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="rounded-xl border border-border bg-surface p-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground sm:text-sm">
                {label}
              </span>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-2xl font-semibold text-foreground">
              {value}
            </p>
            {label === "Streak" &&
              streakFreezes !== undefined &&
              streakFreezes < 3 && (
                <p
                  className={`mt-1 text-xs ${
                    streakFreezes === 0
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }`}
                >
                  🛡️{" "}
                  {streakFreezes === 0
                    ? "0 freezes"
                    : `${streakFreezes} freeze left`}
                </p>
              )}
          </div>
        ))}
      </section>

      {/* Review All Due */}
      {dueNow > 0 && (
        <Link href="/dashboard/learn/review" className="mt-5 block">
          <Button className="w-full rounded-lg" size="lg">
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
        <h2 className="mb-3 text-base font-semibold text-foreground">Decks</h2>
        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-surface p-5"
              >
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="mt-3 h-3 w-1/2" />
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

        <TabsContent value="analytics" className="mt-5">
          <AnalyticsPanel streak={streakValue} />
        </TabsContent>
      </Tabs>

      <CardForm />
      <ManageDeckModal />
      <PDFUploadModal />
    </div>
  );
}
