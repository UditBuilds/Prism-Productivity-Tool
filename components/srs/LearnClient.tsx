"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Plus, Brain, Layers, Flame, CalendarClock, AlertCircle } from "lucide-react";

import { istDayContext } from "@/lib/date";
import { useAllCards, useDeckStats } from "@/hooks/useSRS";
import { useUIStore } from "@/store/ui.store";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { DeckCard } from "@/components/srs/DeckCard";
import { CardForm } from "@/components/srs/CardForm";

export function LearnClient({ streak }: { streak: number }) {
  const openCreateCard = useUIStore((s) => s.openCreateCard);
  const { data: cards, isLoading, isError, refetch } = useAllCards();
  const { data: decks } = useDeckStats();

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

  const stats = [
    { label: "Total Cards", value: total, icon: Layers },
    { label: "Due Today", value: dueToday, icon: CalendarClock },
    { label: "Streak", value: streak === 1 ? "1 day" : `${streak} days`, icon: Flame },
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Learn</h1>
        <Button onClick={openCreateCard} className="rounded-lg">
          <Plus className="mr-1.5 h-4 w-4" />
          Add Card
        </Button>
      </div>

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
          <EmptyState
            icon={Brain}
            title="No flashcards yet"
            description="Add your first card or generate cards from Notes in Session 5."
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
              <DeckCard key={deck.deckName} deck={deck} />
            ))}
          </div>
        )}
      </div>

      <CardForm />
    </div>
  );
}
