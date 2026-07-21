import { cn } from "@/lib/utils";

const HEIGHTS = { xs: "h-1", sm: "h-1.5", md: "h-2" } as const;

/** Fill treatments — flat per the design system (gradients are retired).
    Legacy variant names are kept so callers don't churn. */
const VARIANT_FILL = {
  /** Theme accent / Iris (deck progress, countdowns, weekly day bars). */
  accent: "bg-accent",
  /** Amber urgency (countdowns close to their date). */
  warning: "bg-warning",
  /** Fully complete (plans at 100%). */
  success: "bg-success",
  /** Legacy "accent trending to emerald" (plans ≥60%) — now Moss. */
  "accent-emerald": "bg-success",
  /** Review-session progress — flat accent. */
  "review-gradient": "bg-accent",
  /** Per-category color — pass `color` (hex from categoryChartColor). */
  category: "",
} as const;

export interface ProgressBarProps {
  /** 0–100. Clamped. */
  value: number;
  variant?: keyof typeof VARIANT_FILL;
  /** Hex fill for the `category` variant. */
  color?: string;
  size?: keyof typeof HEIGHTS;
  /** No-op (glows are retired by the design system); kept for caller compat. */
  glow?: boolean;
  /** Extra classes on the fill (e.g. opacity-80 for weekly day bars). */
  fillClassName?: string;
  /** Extra classes on the track. */
  className?: string;
}

/** Shared track + fill used by every inline progress bar in the app. */
export function ProgressBar({
  value,
  variant = "accent",
  color,
  size = "xs",
  fillClassName,
  className,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-full bg-muted",
        HEIGHTS[size],
        className
      )}
    >
      <div
        className={cn(
          "h-full rounded-full transition-all",
          VARIANT_FILL[variant],
          fillClassName
        )}
        style={{
          width: `${pct}%`,
          ...(variant === "category" && color ? { backgroundColor: color } : {}),
        }}
      />
    </div>
  );
}
