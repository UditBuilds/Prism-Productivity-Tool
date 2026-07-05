import { cn } from "@/lib/utils";

const HEIGHTS = { xs: "h-1", sm: "h-1.5", md: "h-2" } as const;

/** Fill treatments — one per pre-existing inline visual. Don't collapse. */
const VARIANT_FILL = {
  /** Theme accent gradient (deck progress, countdowns, weekly day bars). */
  accent: "bg-accent-gradient",
  /** Amber urgency (countdowns close to their date). */
  warning: "bg-warning-gradient",
  /** Fully complete (plans at 100%). */
  success: "bg-success-gradient",
  /** Accent trending to emerald (plans ≥60%). */
  "accent-emerald": "bg-gradient-to-r from-accent to-emerald-400",
  /** Review-session progress (accent → soft → emerald). */
  "review-gradient":
    "bg-gradient-to-r from-accent via-accent-soft to-emerald-400",
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
  /** Soft glow under the fill (plan cards). */
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
  glow = false,
  fillClassName,
  className,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, value));
  const glowShadow =
    variant === "success"
      ? "0 0 6px rgb(16 185 129 / 0.5)"
      : "0 0 6px rgb(var(--accent-rgb) / 0.5)";
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
          ...(glow && pct > 0 ? { boxShadow: glowShadow } : {}),
        }}
      />
    </div>
  );
}
