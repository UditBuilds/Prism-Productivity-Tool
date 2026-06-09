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
            "flex flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-3 text-sm font-semibold hover:-translate-y-0.5 hover:shadow-lg active:scale-95 disabled:pointer-events-none disabled:opacity-50",
            option.className
          )}
        >
          <span>{option.label}</span>
          <span className="mt-0.5 text-[11px] font-normal opacity-60">
            {previewInterval(card, option)}
          </span>
        </button>
      ))}
    </div>
  );
}
