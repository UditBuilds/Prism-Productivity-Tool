"use client";

import { cn } from "@/lib/utils";
import type { SrsCard } from "@/types/database";
import { RATING_OPTIONS, previewInterval } from "./ratings";

export function RatingButtons({
  card,
  onRate,
  disabled,
}: {
  card: SrsCard;
  onRate: (quality: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5">
      {RATING_OPTIONS.map((option) => (
        <button
          key={option.quality}
          type="button"
          disabled={disabled}
          title={`${option.label} — ${option.description}`}
          onClick={() => onRate(option.quality)}
          className={cn(
            "group relative flex min-h-[3.5rem] flex-col items-center justify-center gap-1 rounded-xl border px-3 py-2.5 transition-colors active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
            option.className
          )}
        >
          {/* Keyboard hint — desktop only */}
          <kbd
            aria-hidden
            className="pointer-events-none absolute right-2 top-2 hidden rounded border border-border/70 bg-background/50 px-1 font-sans text-[10px] font-medium leading-tight text-muted-foreground/60 sm:block"
          >
            {option.keyHint}
          </kbd>

          <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <span
              aria-hidden
              className={cn("h-1.5 w-1.5 rounded-full", option.dotClassName)}
            />
            {option.label}
          </span>
          <span className="text-[11px] font-normal tabular-nums text-muted-foreground">
            {previewInterval(card, option)}
          </span>
        </button>
      ))}
    </div>
  );
}
