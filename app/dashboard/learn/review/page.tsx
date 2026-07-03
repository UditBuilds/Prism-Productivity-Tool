"use client";

import { Suspense, useCallback, useEffect, useRef } from "react";
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

  const handleRate = useCallback(
    (quality: number) => {
      const card = sessionCards[currentIndex];
      if (!card) return;
      recordRating(card.id, quality);
      submitReview.mutate({ card_id: card.id, rating: quality });
      nextCard();
    },
    [sessionCards, currentIndex, recordRating, submitReview, nextCard]
  );

  // Keyboard: Space/Enter reveals the answer; 1–4 grade it. Active card only.
  useEffect(() => {
    if (sessionCards.length === 0 || currentIndex >= sessionCards.length) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!isFlipped) {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          flipCard();
        }
        return;
      }
      const idx = ["1", "2", "3", "4"].indexOf(e.key);
      if (idx >= 0) {
        e.preventDefault();
        handleRate(RATING_OPTIONS[idx].quality);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFlipped, currentIndex, sessionCards, flipCard, handleRate]);

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
      <div
        role="status"
        className="flex flex-col items-center justify-center py-24 text-muted-foreground"
      >
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        <p className="mt-3 text-sm">Loading cards…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center justify-center rounded-2xl border border-border bg-surface px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-danger/30 bg-danger/10">
          <AlertCircle className="h-6 w-6 text-danger" />
        </div>
        <p className="mt-5 text-base font-medium text-foreground">
          Couldn&apos;t load cards
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Something went wrong fetching this deck.
        </p>
        <div className="mt-6 flex gap-2">
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
      <div className="mx-auto flex max-w-md flex-col items-center justify-center rounded-2xl border border-border bg-surface px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-success/30 bg-success/10">
          <CheckCircle2 className="h-6 w-6 text-success" />
        </div>
        <p className="mt-5 text-lg font-semibold text-foreground">All caught up</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {deck
            ? `No cards are due in "${deck}" right now.`
            : "You have no reviews due. Check back later."}
        </p>
        <BackToLearn className="mt-6" />
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

    // Confetti burst vectors — deterministic spread around the check icon.
    const confetti = [
      { cx: -70, cy: -50, color: "rgb(var(--accent-rgb))", delay: "0s" },
      { cx: 60, cy: -65, color: "#34D399", delay: "0.05s" },
      { cx: -35, cy: -80, color: "#FBBF24", delay: "0.1s" },
      { cx: 80, cy: -30, color: "rgb(var(--accent-soft-rgb))", delay: "0.12s" },
      { cx: -85, cy: -15, color: "#34D399", delay: "0.18s" },
      { cx: 30, cy: -85, color: "rgb(var(--accent-rgb))", delay: "0.22s" },
      { cx: -55, cy: -35, color: "#FBBF24", delay: "0.28s" },
      { cx: 70, cy: -55, color: "rgb(var(--accent-soft-rgb))", delay: "0.32s" },
    ];

    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
        <div className="relative">
          {confetti.map((c, i) => (
            <span
              key={i}
              aria-hidden
              className="confetti-dot"
              style={{
                ["--cx" as string]: `${c.cx}px`,
                ["--cy" as string]: `${c.cy}px`,
                backgroundColor: c.color,
                animationDelay: c.delay,
              }}
            />
          ))}
          <div className="flex h-12 w-12 animate-pop items-center justify-center rounded-full border border-accent/30 bg-accent/10 shadow-glow-accent">
            <CheckCircle2 className="h-6 w-6 text-accent" />
          </div>
        </div>
        <h1 className="text-gradient mt-5 text-xl font-semibold tracking-tight">
          Session complete
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ratingsGiven.length} card{ratingsGiven.length === 1 ? "" : "s"} reviewed
        </p>

        <div className="stagger-children mt-7 grid w-full grid-cols-4 gap-2">
          {counts.map(({ label, quality, count }) => {
            const dot = RATING_OPTIONS.find(
              (o) => o.quality === quality
            )?.dotClassName;
            return (
              <div
                key={quality}
                className="rounded-xl border border-border bg-surface-raised p-3"
              >
                <p className="text-lg font-semibold tabular-nums text-foreground">
                  {count}
                </p>
                <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    aria-hidden
                    className={cn("h-1.5 w-1.5 rounded-full", dot)}
                  />
                  {label}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
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
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium tabular-nums text-foreground">
            {currentIndex + 1}
            <span className="text-muted-foreground"> / {sessionCards.length}</span>
          </span>
          {deck && (
            <span className="max-w-[55%] truncate rounded-full border border-border bg-surface-raised px-2.5 py-0.5 text-xs text-muted-foreground">
              {deck}
            </span>
          )}
        </div>
        <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent via-accent-soft to-emerald-400 transition-[width] duration-300 ease-out"
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
          <p className="flex min-h-[3.5rem] items-center justify-center text-center text-sm text-muted-foreground/70">
            Reveal the answer to grade your recall
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
        <div
          role="status"
          aria-label="Loading review session"
          className="flex justify-center py-24 text-muted-foreground"
        >
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        </div>
      }
    >
      <ReviewSession />
    </Suspense>
  );
}
