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
      "border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
    requeues: true,
  },
  {
    quality: 2,
    label: "Hard",
    description: "Hard",
    className:
      "border-warning/40 bg-warning/10 text-warning hover:bg-warning/20",
    requeues: true,
  },
  {
    quality: 4,
    label: "Good",
    description: "Got it",
    className:
      "border-blue-500/40 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20",
    requeues: false,
  },
  {
    quality: 5,
    label: "Easy",
    description: "Easy",
    className:
      "border-success/40 bg-success/10 text-success hover:bg-success/20",
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
