"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { FileText, Layers, Play } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DeckStat } from "@/hooks/useSRS";
import { Button } from "@/components/ui/button";

export function DeckCard({
  deck,
  sourceNoteTitle,
}: {
  deck: DeckStat;
  sourceNoteTitle?: string;
}) {
  const learned = deck.total - deck.dueCount;
  const pct = deck.total === 0 ? 0 : Math.round((learned / deck.total) * 100);
  const lastReviewed = deck.lastReviewed
    ? formatDistanceToNow(new Date(deck.lastReviewed), { addSuffix: true })
    : "Never";

  const reviewHref = `/dashboard/learn/review?deck=${encodeURIComponent(
    deck.deckName
  )}`;

  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h3 className="truncate text-sm font-semibold text-foreground">
            {deck.deckName}
          </h3>
        </div>
      </div>

      {sourceNoteTitle && (
        <span className="mt-2 inline-flex max-w-full items-center gap-1 self-start rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          <FileText className="h-3 w-3 shrink-0" />
          <span className="truncate">From: {sourceNoteTitle}</span>
        </span>
      )}

      <p className="mt-2 text-sm text-muted-foreground">
        {deck.total} card{deck.total === 1 ? "" : "s"} ·{" "}
        <span
          className={cn(
            deck.dueCount > 0
              ? "font-medium text-accent"
              : "text-muted-foreground"
          )}
        >
          {deck.dueCount} due
        </span>
      </p>

      {/* Progress: how many cards are not currently due */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Reviewed last: {lastReviewed}</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="mt-4">
        {deck.dueCount > 0 ? (
          <Button asChild className="w-full rounded-lg">
            <Link href={reviewHref}>
              <Play className="mr-1.5 h-4 w-4" />
              Review ({deck.dueCount})
            </Link>
          </Button>
        ) : (
          <Button disabled className="w-full rounded-lg">
            <Play className="mr-1.5 h-4 w-4" />
            Nothing due
          </Button>
        )}
      </div>
    </div>
  );
}
