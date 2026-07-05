import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * SVG polyline points for a small sparkline (values oldest→newest). The 100×24
 * viewBox stretches to the container (preserveAspectRatio="none"); the caller's
 * vector-effect keeps the stroke undistorted. All-zero values → flat baseline.
 */
function sparklinePoints(values: number[]): string {
  const W = 100;
  const H = 24;
  const PAD = 3; // keeps the line off the top/bottom edges
  const max = Math.max(...values, 1); // avoid /0; a flat-zero week sits on the baseline
  const stepX = values.length > 1 ? W / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = i * stepX;
      const y = H - PAD - (v / max) * (H - 2 * PAD);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  /** Extra classes on the icon — animation/tint variants (flame flicker, bell ring…). */
  iconClassName?: string;
  /** Value treatment. Default is solid foreground. */
  valueVariant?: "default" | "gradient" | "gradient-success";
  /** Value size: lg = dashboard hero cards, md = secondary strips. */
  size?: "md" | "lg";
  /** Pulsing accent ring around the card (attention state). */
  pulse?: boolean;
  /** 7-value trend rendered under the value with an accent gradient stroke. */
  sparkline?: number[];
  /** Small line under the value (e.g. streak-freeze indicator). */
  subtitle?: React.ReactNode;
  className?: string;
}

/**
 * The one stat tile used by Dashboard, Learn, and Weekly Review. Presentational
 * and server-safe; variants cover the per-screen animation/value treatments.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  iconClassName,
  valueVariant = "default",
  size = "lg",
  pulse = false,
  sparkline,
  subtitle,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "cursor-default rounded-xl border border-border bg-surface p-4 transition-[transform,border-color,background-color,box-shadow] duration-200 hover:scale-[1.01] hover:border-accent/30 hover:bg-surface-raised/60 hover:shadow-lift",
        pulse && "animate-pulse-ring",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <Icon
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground/40",
              iconClassName
            )}
          />
        )}
      </div>
      <p
        className={cn(
          "mt-2 tabular-nums tracking-tight",
          size === "lg" ? "text-3xl font-bold" : "text-2xl font-bold",
          valueVariant === "default" && "text-foreground",
          valueVariant === "gradient" && "text-gradient",
          valueVariant === "gradient-success" &&
            "bg-gradient-to-r from-accent to-emerald-400 bg-clip-text text-transparent"
        )}
      >
        {value}
      </p>
      {sparkline && (
        <svg
          viewBox="0 0 100 24"
          preserveAspectRatio="none"
          aria-hidden
          className="mt-2 h-6 w-full"
        >
          <defs>
            <linearGradient id="stat-spark-stroke" x1="0" y1="0" x2="1" y2="0">
              <stop
                offset="0%"
                style={{ stopColor: "rgb(var(--accent-rgb))", stopOpacity: 0.35 }}
              />
              <stop
                offset="100%"
                style={{
                  stopColor: "rgb(var(--accent-soft-rgb))",
                  stopOpacity: 1,
                }}
              />
            </linearGradient>
          </defs>
          <polyline
            points={sparklinePoints(sparkline)}
            fill="none"
            stroke="url(#stat-spark-stroke)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
      {subtitle}
    </div>
  );
}
