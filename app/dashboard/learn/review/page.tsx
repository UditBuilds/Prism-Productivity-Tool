"use client";

import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

import { useDueCards, useSubmitReview } from "@/hooks/useSRS";
import { useUIStore } from "@/store/ui.store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FlashCard } from "@/components/srs/FlashCard";
import { RatingButtons } from "@/components/srs/RatingButtons";
import { RATING_OPTIONS } from "@/components/srs/ratings";

function BackToLearn({ className }: { className?: string }) {
  return (
    <Button asChild variant="outline" className={cn("rounded-lg", className)}>
      <Link href="/dashboard/learn">Back to Learn</Link>
    </Button>
  );
}

function ReviewSession() {
  const searchParams = useSearchParams();
  const deck = searchParams.get("deck") ?? undefined;

  const { data: dueCards, isLoading, isError, refetch } = useDueCards(deck);
  const submitReview = useSubmitReview();

  const sessionCards = useUIStore((s) => s.sessionCards);
  const currentIndex = useUIStore((s) => s.currentIndex);
  const isFlipped = useUIStore((s) => s.isFlipped);
  const ratingsGiven = useUIStore((s) => s.ratingsGiven);
  const startSession = useUIStore((s) => s.startSession);
  const flipCard = useUIStore((s) => s.flipCard);
  const nextCard = useUIStore((s) => s.nextCard);
  const recordRating = useUIStore((s) => s.recordRating);
  const resetSession = useUIStore((s) => s.resetSession);

  const startedRef = useRef(false);

  // Snapshot the due cards into the session exactly once, after they load.
  // Guard with startedRef so the background refetch triggered by each review
  // submit (which changes `dueCards`) doesn't restart the in-progress session.
  useEffect(() => {
    if (!dueCards || startedRef.current) return;
    startedRef.current = true;
    startSession(dueCards);
  }, [dueCards, startSession]);

  // Clear session state when leaving the page. Resetting startedRef here is
  // essential: under React Strict Mode the mount→cleanup→remount cycle would
  // otherwise reset the session (clearing sessionCards) while leaving the guard
  // set, so the remount never re-snapshots and the page shows "Nothing due!".
  useEffect(() => {
    return () => {
      startedRef.current = false;
      resetSession();
    };
  }, [resetSession]);

  function handleRate(quality: number) {
    const card = sessionCards[currentIndex];
    if (!card) return;
    recordRating(card.id, quality);
    submitReview.mutate({ card_id: card.id, rating: quality });
    nextCard();
  }

  function handleReviewAgain() {
    const againCards = sessionCards.filter((c) =>
      ratingsGiven.some(
        (r) => r.card_id === c.id && (r.rating === 0 || r.rating === 2)
      )
    );
    startSession(againCards);
  }

  // --- Loading / error ---
  if (isLoading || !startedRef.current) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="mt-3 text-sm">Loading cards…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface px-6 py-16 text-center">
        <AlertCircle className="h-10 w-10 text-danger" />
        <p className="mt-4 text-base font-medium text-foreground">
          Couldn&apos;t load cards
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
          <BackToLearn />
        </div>
      </div>
    );
  }

  // --- Nothing due ---
  if (sessionCards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface px-6 py-16 text-center">
        <CheckCircle2 className="h-12 w-12 text-success" />
        <p className="mt-4 text-lg font-semibold text-foreground">
          Nothing due!
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {deck
            ? `No cards due in "${deck}" right now.`
            : "You're all caught up on reviews."}
        </p>
        <BackToLearn className="mt-5" />
      </div>
    );
  }

  // --- Session complete ---
  if (currentIndex >= sessionCards.length) {
    const counts = RATING_OPTIONS.map((opt) => ({
      label: opt.label,
      quality: opt.quality,
      count: ratingsGiven.filter((r) => r.rating === opt.quality).length,
    }));
    const lapses = ratingsGiven.filter(
      (r) => r.rating === 0 || r.rating === 2
    ).length;

    return (
      <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
        <CheckCircle2 className="h-14 w-14 text-success" />
        <h1 className="mt-4 text-2xl font-semibold text-foreground">
          Session complete!
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ratingsGiven.length} card{ratingsGiven.length === 1 ? "" : "s"}{" "}
          reviewed
        </p>

        <div className="mt-6 grid w-full max-w-md grid-cols-4 gap-2">
          {counts.map(({ label, quality, count }) => (
            <div
              key={quality}
              className="rounded-lg border border-border bg-surface p-3"
            >
              <p className="text-lg font-semibold text-foreground tabular-nums">
                {count}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          <BackToLearn />
          {lapses > 0 && (
            <Button className="rounded-lg" onClick={handleReviewAgain}>
              Review again ({lapses})
            </Button>
          )}
        </div>
      </div>
    );
  }

  // --- Active review ---
  const card = sessionCards[currentIndex];
  const progressPct = (currentIndex / sessionCards.length) * 100;

  return (
    <div className="mx-auto flex max-w-2xl flex-col">
      {/* Progress */}
      <div>
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Card {currentIndex + 1} of {sessionCards.length}
          </span>
          {deck && <span className="truncate">{deck}</span>}
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Card */}
      <div className="mt-8">
        <FlashCard
          front={card.front}
          back={card.back}
          isFlipped={isFlipped}
          onFlip={flipCard}
        />
      </div>

      {/* Controls — sticky to the thumb zone (above the bottom nav) on mobile */}
      <div className="sticky bottom-[calc(4rem_+_env(safe-area-inset-bottom))] z-20 -mx-4 mt-6 min-h-[5rem] border-t border-[#1A1A1A] bg-background/95 px-4 py-4 backdrop-blur-sm sm:static sm:mx-0 sm:border-none sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        {isFlipped ? (
          <RatingButtons card={card} onRate={handleRate} />
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            Tap card to reveal answer
          </p>
        )}
      </div>

      {/* End early */}
      <div className="mt-8 text-center">
        <Link
          href="/dashboard/learn"
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          End session early
        </Link>
      </div>
    </div>
  );
}

export default function ReviewPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-24 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <ReviewSession />
    </Suspense>
  );
}
