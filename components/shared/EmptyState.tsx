import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * How much room the empty state is allowed to take.
 *
 * - `default` — full card: floating icon, title, description, action.
 * - `compact` — same card, tighter paddings, for inline panel slots.
 * - `inline`  — a single row on the page itself: small leading icon, title,
 *   action. NO card — no border, no background — and no description line
 *   (see `description` below).
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
 * do. It is one row instead of a card.
 *
 * It draws NO surface of its own. It used to keep the dashed card, on the
 * theory that it was the same language one row tall — but once the dashboard's
 * sections were de-boxed, the empty states were the only thing still drawing
 * boxes, and on an ordinary day three of four sections are empty. Measured on
 * the real page: 3 of 4 sections still rendered a bordered surface totalling
 * 174px, so de-boxing the sections had bought almost nothing. A section with
 * nothing in it should be a quiet line, not a framed announcement.
 *
 * Every `inline` call site is a dashboard section (Due Today, Workout,
 * Upcoming, Revisit) — Focus, Learn, Calendar and Weekly Review use `default`
 * or `compact` and are unaffected by this.
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
          // occupies exactly the space one row would. Both moved 12 -> 16 with
          // the spacing scale; they stay in step. The gap stays 8, not the
          // row's 16: this leading icon is a bare glyph, where the row's is a
          // 36px bubble — a container, and containers take space-around.
          "flex items-center gap-2 p-4",
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
      {/* On the scale: 16 between the icon and the title block (two sub-groups),
          8 between the title and its own description (one object), 16 before
          the action. Was 12/16, 4, 12/20. */}
      <p className="mt-4 text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
