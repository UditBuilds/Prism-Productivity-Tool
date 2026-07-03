import { calculateSM2 } from "@/lib/srs/sm2";
import type { SrsCard } from "@/types/database";

export interface RatingOption {
  /** SM-2 quality value persisted on review. */
  quality: number;
  /** Big label on the button. */
  label: string;
  /** Descriptive helper (title / a11y). */
  description: string;
  /** Restrained button surface — neutral, with a tone-tinted hover. */
  className: string;
  /** Semantic status dot (color carries the meaning, not a full fill). */
  dotClassName: string;
  /** Keyboard shortcut shown as a subtle hint and bound in the review page. */
  keyHint: string;
  /** Whether this rating re-queues the card later in the same session. */
  requeues: boolean;
}

// Order matches how the four buttons are laid out, easiest-forgotten → easiest,
// and maps directly to keyboard keys 1–4.
export const RATING_OPTIONS: RatingOption[] = [
  {
    quality: 0,
    label: "Again",
    description: "Forgot it",
    className:
      "border-border bg-surface-raised hover:border-red-500/40 hover:bg-red-500/[0.08] hover:shadow-[0_0_14px_rgb(248_113_113/0.25)]",
    dotClassName: "bg-red-400",
    keyHint: "1",
    requeues: true,
  },
  {
    quality: 2,
    label: "Hard",
    description: "Recalled with effort",
    className:
      "border-border bg-surface-raised hover:border-amber-500/40 hover:bg-amber-500/[0.08] hover:shadow-[0_0_14px_rgb(251_191_36/0.25)]",
    dotClassName: "bg-amber-400",
    keyHint: "2",
    requeues: true,
  },
  {
    quality: 4,
    label: "Good",
    description: "Recalled correctly",
    className:
      "border-border bg-surface-raised hover:border-blue-500/40 hover:bg-blue-500/[0.08] hover:shadow-[0_0_14px_rgb(96_165_250/0.25)]",
    dotClassName: "bg-blue-400",
    keyHint: "3",
    requeues: false,
  },
  {
    quality: 5,
    label: "Easy",
    description: "Effortless",
    className:
      "border-border bg-surface-raised hover:border-emerald-500/40 hover:bg-emerald-500/[0.08] hover:shadow-[0_0_14px_rgb(52_211_153/0.25)]",
    dotClassName: "bg-emerald-400",
    keyHint: "4",
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
