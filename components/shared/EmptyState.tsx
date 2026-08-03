import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * How much room the empty state is allowed to take.
 *
 * - `default` — full card: floating icon, title, description, action.
 * - `compact` — same card, tighter paddings, for inline panel slots.
 * - `inline`  — a single row: small leading icon, title, action. No icon
 *   circle and no description line (see `description` below).
 */
export type EmptyStateDensity = "default" | "compact" | "inline";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  /** Second line under the title. NOT rendered at `inline` density. */
  description?: string;
  action?: React.ReactNode;
  /**
   * Defaults to the full card. `compact` tightens the paddings for inline
   * panel slots (calendar day panel, widgets); `inline` collapses the whole
   * thing to one row for sections that are empty most days.
   */
  density?: EmptyStateDensity;
  className?: string;
}

/**
 * Standard empty/error state: dashed card, floating icon, title, description,
 * one action. Used for errors and per-filter empties — first-run full-page
 * empties use the illustrated EmptyShell variants in EmptyStates.tsx.
 *
 * The `inline` density exists because a section that is empty on most days
 * (Due Today, for a user who usually has nothing due) otherwise renders the
 * largest element on the first screen to announce that there is nothing to
 * do. It is the same component and the same dashed-surface language — just
 * one row instead of a card.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  density = "default",
  className,
}: EmptyStateProps) {
  if (density === "inline") {
    return (
      <div
        className={cn(
          // Same padding as the dashboard row primitive, so an empty section
          // occupies exactly the space one row would.
          "flex items-center gap-2 rounded-xl border border-dashed border-border bg-surface px-4 py-3",
          className
        )}
      >
        <Icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {title}
        </p>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    );
  }

  const compact = density === "compact";

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-surface text-center",
        compact ? "px-4 py-8" : "px-6 py-14",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-full border border-border bg-surface-raised",
          compact ? "h-11 w-11" : "h-12 w-12"
        )}
      >
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className={cn("text-sm font-medium text-foreground", compact ? "mt-3" : "mt-4")}>
        {title}
      </p>
      {description && (
        <p className="mt-1 max-w-xs text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className={compact ? "mt-3" : "mt-5"}>{action}</div>}
    </div>
  );
}
