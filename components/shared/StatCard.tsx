import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { MonoLabel } from "@/components/shared/MonoLabel";

/**
 * Tap affordance for a linked tile, borrowed wholesale from the TopBar icon
 * buttons — muted label brightening to foreground on hover, the standard
 * focus ring, and the same press-scale. No new hover or press style.
 */
const LINKED =
  "outline-none ring-offset-background transition-colors focus-visible:ring-2 focus-visible:ring-ring active:scale-95";

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  /** Extra classes on the icon — tint variants (e.g. amber urgency). */
  iconClassName?: string;
  /**
   * Value tint. Default is solid foreground; accent/success/warning are
   * semantic. `muted` is for a counter reading ZERO — an absence of work
   * should recede, not compete with the one number that is actually owed.
   */
  valueVariant?:
    | "default"
    | "muted"
    | "gradient"
    | "gradient-success"
    | "warning";
  /** Value size: lg = dashboard hero cards, md = secondary strips. */
  size?: "md" | "lg";
  /**
   * "card" (default) is the bordered tile. "strip" drops the chrome entirely
   * for the dashboard's four-across counter row, where a 375px viewport leaves
   * ~83px per column — no room for a border box or the decorative icon.
   * Learn, Weekly Review and PlanCard keep the card and are untouched.
   */
  variant?: "card" | "strip";
  /**
   * Makes the whole tile a link to where the number can be acted on. The
   * counter is often the most actionable thing on the screen ("REVIEW 16"),
   * and it was previously inert.
   */
  href?: string;
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
  href,
  subtitle,
  className,
}: StatCardProps) {
  const valueTint = cn(
    valueVariant === "default" && "text-foreground",
    valueVariant === "muted" && "text-muted-foreground",
    valueVariant === "gradient" && "text-accent",
    valueVariant === "gradient-success" && "text-success",
    valueVariant === "warning" && "text-warning"
  );

  if (variant === "strip") {
    // The strip lives in a grid-cols-4 gap-1 row. It no longer has to reserve
    // 81px for a Day Rail — the rail was replaced by a text sub-line — so the
    // column is free to be whatever a quarter of the content width is. The link
    // still adds no padding of its own.
    const body = (
      <>
        <MonoLabel
          as="span"
          className={cn("block truncate", href && "group-hover:text-foreground")}
        >
          {label}
        </MonoLabel>
        {/* space-inside (8): a label and its figure are one object.
            THE FIGURE IS SANS, NOT MONO. Two reasons, and the second is the
            one that matters. First, the type direction carries hierarchy on
            size/weight/case/colour alone, and a mono figure under a mono label
            gives the pair no contrast to work with — the label stops reading as
            subordinate. Second, JetBrains Mono draws a DOTTED zero: at 30px in
            muted grey a `0` came out as a narrow ring with a dot in it, which
            read as an outlined glyph rather than as the number nought. On a
            page whose normal day is three zeros and one number, that is the
            single most-rendered glyph on the screen. Instrument Sans draws a
            plain `0`. tabular-nums is kept — Instrument Sans carries tnum, so
            the figures still align column to column. */}
        <p
          className={cn(
            "mt-2 font-sans text-3xl font-semibold tabular-nums tracking-tight",
            valueTint
          )}
        >
          {value}
        </p>
        {subtitle}
      </>
    );

    return href ? (
      <Link href={href} className={cn("group block min-w-0 rounded-lg", LINKED, className)}>
        {body}
      </Link>
    ) : (
      <div className={cn("min-w-0", className)}>{body}</div>
    );
  }

  const cardBody = (
    <>
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
    </>
  );

  const cardClass = cn(
    "rounded-xl border border-border bg-surface p-4 hover:border-border-col",
    href ? LINKED : "cursor-default",
    className
  );

  return href ? (
    <Link href={href} className={cn("block", cardClass)}>
      {cardBody}
    </Link>
  ) : (
    <div className={cardClass}>{cardBody}</div>
  );
}
