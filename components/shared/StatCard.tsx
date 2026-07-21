import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  /** Extra classes on the icon — tint variants (e.g. amber urgency). */
  iconClassName?: string;
  /** Value tint. Default is solid foreground; accent/success/warning are semantic. */
  valueVariant?: "default" | "gradient" | "gradient-success" | "warning";
  /** Value size: lg = dashboard hero cards, md = secondary strips. */
  size?: "md" | "lg";
  /** Pulsing accent ring around the card (attention state). */
  pulse?: boolean;
  /** Small slot under the value (Day Rail, streak-freeze indicator…). */
  subtitle?: React.ReactNode;
  className?: string;
}

/**
 * The one stat tile used by Dashboard, Learn, and Weekly Review. Presentational
 * and server-safe. Graphite surface + hairline; computed values render in the
 * mono face per the design system ("if Prism computed the number, it's mono").
 * The legacy "gradient"/"gradient-success" variant names are kept for callers
 * but now resolve to flat accent/success tints — gradients are retired.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  iconClassName,
  valueVariant = "default",
  size = "lg",
  pulse = false,
  subtitle,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "cursor-default rounded-xl border border-border bg-surface p-4 hover:border-border-col",
        pulse && "animate-pulse-ring",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
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
          "mt-2 font-mono font-semibold tabular-nums tracking-tight",
          size === "lg" ? "text-3xl" : "text-2xl",
          valueVariant === "default" && "text-foreground",
          valueVariant === "gradient" && "text-accent",
          valueVariant === "gradient-success" && "text-success",
          valueVariant === "warning" && "text-warning"
        )}
      >
        {value}
      </p>
      {subtitle}
    </div>
  );
}
