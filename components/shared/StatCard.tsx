import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { MonoLabel } from "@/components/shared/MonoLabel";

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
  /**
   * "card" (default) is the bordered tile. "strip" drops the chrome entirely
   * for the dashboard's four-across counter row, where a 375px viewport leaves
   * ~83px per column — no room for a border box or the decorative icon.
   * Learn, Weekly Review and PlanCard keep the card and are untouched.
   */
  variant?: "card" | "strip";
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
  variant = "card",
  subtitle,
  className,
}: StatCardProps) {
  const valueTint = cn(
    valueVariant === "default" && "text-foreground",
    valueVariant === "gradient" && "text-accent",
    valueVariant === "gradient-success" && "text-success",
    valueVariant === "warning" && "text-warning"
  );

  if (variant === "strip") {
    return (
      <div className={cn("min-w-0", className)}>
        <MonoLabel as="span" className="block truncate">
          {label}
        </MonoLabel>
        <p
          className={cn(
            "mt-0.5 font-mono text-3xl font-semibold tabular-nums tracking-tight",
            valueTint
          )}
        >
          {value}
        </p>
        {subtitle}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "cursor-default rounded-xl border border-border bg-surface p-4 hover:border-border-col",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <MonoLabel as="span" className="truncate">
          {label}
        </MonoLabel>
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
          valueTint
        )}
      >
        {value}
      </p>
      {subtitle}
    </div>
  );
}
