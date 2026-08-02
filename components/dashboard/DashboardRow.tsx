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
        {meta && <div className="mt-0.5 truncate">{meta}</div>}
        {below}
      </div>
      {trailing && (
        <div className="flex shrink-0 items-center gap-2">{trailing}</div>
      )}
    </>
  );

  const bodyClass = cn(
    "flex min-w-0 flex-1 items-center gap-3 py-3 pr-4",
    leadingInteractive ? "pl-3" : "pl-4"
  );

  return (
    <li
      className={cn(
        "group flex items-center rounded-xl border border-border bg-surface transition-colors hover:border-accent/25",
        accentBorder && "border-l-2",
        accentBorder,
        className
      )}
    >
      {leadingInteractive && leading && (
        <div className="flex shrink-0 items-center py-3 pl-4">{leading}</div>
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
