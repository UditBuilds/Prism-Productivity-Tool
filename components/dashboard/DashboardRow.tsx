import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The leading circle. Exported because an INTERACTIVE leading slot has to be
 * the button itself (so the whole 36px circle is the tap target) rather than
 * something wrapped in a div — see `leadingInteractive` below.
 */
export const ROW_BUBBLE =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-raised";

export interface DashboardRowProps {
  /** Icon, emoji, or interactive control in the leading circle. */
  leading?: React.ReactNode;
  /**
   * Render `leading` OUTSIDE the link. Required when it is itself interactive:
   * a <button> inside an <a> is invalid markup and the tap would also
   * navigate. Such a caller styles its own control with ROW_BUBBLE.
   */
  leadingInteractive?: boolean;
  /** Extra classes on the (non-interactive) bubble — e.g. the due-soon ring. */
  bubbleClassName?: string;
  /** When set, the body is a Link. Padding lives INSIDE it, so the whole row is tappable. */
  href?: string;
  title: React.ReactNode;
  /** Sits beside the title at its own size — the recurring-task marker. */
  titleAdornment?: React.ReactNode;
  /** Second line under the title (due label, reminder time). */
  meta?: React.ReactNode;
  /** Right-hand slot — priority/status pills, countdown label. */
  trailing?: React.ReactNode;
  /** Full-width slot under the title — the countdown progress bar. */
  below?: React.ReactNode;
  /** Priority left border from task-styles; adds the 2px rule when present. */
  accentBorder?: string;
  className?: string;
}

/**
 * The one row used by all four dashboard row kinds — due task, upcoming task,
 * countdown and reminder. Before this the chrome string was copy-pasted four
 * times and the two extracted row components had drifted apart on title
 * weight, padding location, left border and icon bubble.
 *
 * Presentational and server-safe; interactivity is passed in via `leading`.
 */
export function DashboardRow({
  leading,
  leadingInteractive = false,
  bubbleClassName,
  href,
  title,
  titleAdornment,
  meta,
  trailing,
  below,
  accentBorder,
  className,
}: DashboardRowProps) {
  const body = (
    <>
      {leading && !leadingInteractive && (
        <span aria-hidden className={cn(ROW_BUBBLE, bubbleClassName)}>
          {leading}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-semibold text-foreground">
            {title}
          </span>
          {titleAdornment}
        </div>
        {/* space-inside (8): the title and its meta line are one object. */}
        {meta && <div className="mt-2 truncate">{meta}</div>}
        {below}
      </div>
      {trailing && (
        <div className="flex shrink-0 items-center gap-2">{trailing}</div>
      )}
    </>
  );

  // space-around (16) on every side. The old 12/16 split — and the 12px inset
  // that only the interactive-leading variant used — were two of the three
  // padding regimes on this page.
  const bodyClass = "flex min-w-0 flex-1 items-center gap-4 py-4 pr-4 pl-4";

  return (
    <li
      className={cn(
        // A partition of the section's tier-1 card, not a card of its own.
        // It used to be tier-1 (bg-surface + hairline) sitting directly on the
        // page — the same depth as the Workout card that CONTAINS things —
        // which is why nothing on this page receded. Separation is the parent
        // <ul>'s `divide-y`; hover raises the row to tier 2 rather than
        // outlining it, so nothing shifts.
        "group flex items-center transition-colors hover:bg-surface-raised",
        accentBorder && "border-l-2",
        accentBorder,
        className
      )}
    >
      {leadingInteractive && leading && (
        <div className="flex shrink-0 items-center py-4 pl-4">{leading}</div>
      )}
      {href ? (
        <Link href={href} className={bodyClass}>
          {body}
        </Link>
      ) : (
        <div className={bodyClass}>{body}</div>
      )}
    </li>
  );
}
