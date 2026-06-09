import { calculateSM2 } from "@/lib/srs/sm2";
import type { SrsCard } from "@/types/database";

export interface RatingOption {
  /** SM-2 quality value persisted on review. */
  quality: number;
  /** Big label on the button. */
  label: string;
  /** Descriptive helper (title / a11y). */
  description: string;
  /** Tailwind classes for the button surface. */
  className: string;
  /** Whether this rating re-queues the card later in the same session. */
  requeues: boolean;
}

// Order matches how the four buttons are laid out, easiest-forgotten → easiest.
export const RATING_OPTIONS: RatingOption[] = [
  {
    quality: 0,
    label: "Again",
    description: "Forgot it",
    className:
      "border border-red-800/40 bg-red-950/50 text-red-400 hover:bg-red-900/50 hover:shadow-red-900/20",
    requeues: true,
  },
  {
    quality: 2,
    label: "Hard",
    description: "Hard",
    className:
      "border border-amber-800/40 bg-amber-950/50 text-amber-400 hover:bg-amber-900/50 hover:shadow-amber-900/20",
    requeues: true,
  },
  {
    quality: 4,
    label: "Good",
    description: "Got it",
    className:
      "border border-blue-800/40 bg-blue-950/50 text-blue-400 hover:bg-blue-900/50 hover:shadow-blue-900/20",
    requeues: false,
  },
  {
    quality: 5,
    label: "Easy",
    description: "Easy",
    className:
      "border border-green-800/40 bg-green-950/50 text-green-400 hover:bg-green-900/50 hover:shadow-green-900/20",
    requeues: false,
  },
];

/** Short label for a quality value, for the session-complete breakdown. */
export function labelForQuality(quality: number): string {
  return RATING_OPTIONS.find((o) => o.quality === quality)?.label ?? "—";
}

/**
 * Human preview of the next interval a rating would produce for this card.
 * "Again" re-queues within the session, so it reads "<1 min"; the rest show the
 * SM-2 schedule in days.
 */
export function previewInterval(card: SrsCard, option: RatingOption): string {
  if (option.quality < 3) {
    // Lapses re-appear immediately in-session rather than after the 1-day floor.
    if (option.requeues && option.quality === 0) return "<1 min";
  }
  const { interval } = calculateSM2(
    option.quality,
    card.repetitions,
    card.ease_factor,
    card.interval_days
  );
  return interval === 1 ? "1 day" : `${interval} days`;
}
