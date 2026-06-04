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
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {RATING_OPTIONS.map((option) => (
        <button
          key={option.quality}
          type="button"
          disabled={disabled}
          title={option.description}
          onClick={() => onRate(option.quality)}
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 rounded-xl border px-3 py-3 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50",
            option.className
          )}
        >
          <span>{option.label}</span>
          <span className="text-xs font-normal opacity-80">
            {previewInterval(card, option)}
          </span>
        </button>
      ))}
    </div>
  );
}
