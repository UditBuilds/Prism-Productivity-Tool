import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The leading glyph slot.
 *
 * It keeps its 36px box — a tap target has to survive a design direction — but
 * has lost the `rounded-full bg-surface-raised` that made the box VISIBLE. The
 * glyph now sits on the page background like a piece of punctuation. Still
 * exported because an interactive leading slot has to BE the button, so that
 * the whole 36px is tappable rather than just the 16px glyph inside it.
 */
export const ROW_BUBBLE =
  "flex h-9 w-9 shrink-0 items-center justify-center";

/**
 * The meta line: one mono-caps rule for every row kind.
 *
 * Rows used to carry their state in three places at once — a due label on the
 * meta line, a recurrence glyph beside it, and a filled priority pill in a
 * trailing slot. That is three anatomies for one sentence. Everything a row has
 * to say about its own state is now ONE line of mono caps, segment-separated,
 * each segment free to carry its own tint: `3 DAYS OVERDUE · MEDIUM · DAILY`.
 *
 * 12px is the Meta rank of the type scale, and mono caps is the Object rank's
 * established treatment (MonoLabel). Colour is not set here — the segments rank
 * themselves, which is the whole mechanism this direction runs on.
 *
 * `tracking-meta` (0.06em) rather than the 0.10em this started at. Uppercase
 * needs air, but 0.10em was wide enough that "3 DAYS OVERDUE · MEDIUM · DAILY"
 * could not fit the width left after the leading glyph and two 16px insets,
 * and wrapped to a second line. 0.06em keeps it on one.
 */
export const ROW_META =
  "block font-mono text-xs font-medium uppercase leading-5 tracking-meta tabular-nums";

export interface DashboardRowProps {
  /** Icon or glyph in the leading slot. */
  leading?: React.ReactNode;
  /**
   * Render `leading` OUTSIDE the link. Required when it is itself interactive:
   * a <button> inside an <a> is invalid markup and the tap would also
   * navigate. Such a caller styles its own control with ROW_BUBBLE.
   */
  leadingInteractive?: boolean;
  /** When set, the body is a Link. Padding lives INSIDE it, so the whole row is tappable. */
  href?: string;
  title: React.ReactNode;
  /**
   * The single mono-caps state line under the title. Compose it with ROW_META
   * and tint the segments; see AgendaTaskRow for the ranking.
   */
  meta?: React.ReactNode;
  className?: string;
}

/**
 * The one row used by all four dashboard row kinds — due task, upcoming task,
 * countdown and reminder.
 *
 * WHAT THIS DIRECTION TOOK OUT. The `trailing` and `below` slots are gone, not
 * merely unused: `trailing` existed for the priority and countdown pills, and
 * `below` for the countdown progress bar. Both are surfaces, and both said
 * something the meta line can say in words — priority is a word, and a progress
 * bar is a percentage. Leaving the props in place would have left the next
 * person a supported way to put the chrome back. `bubbleClassName` went with
 * them (it existed for the due-soon ring; urgency is now the meta tint).
 *
 * Hover does NOT raise the row to a surface any more. It brightens the title,
 * which is the only move available to a direction with no surfaces to raise.
 *
 * Presentational and server-safe; interactivity is passed in via `leading`.
 */
export function DashboardRow({
  leading,
  leadingInteractive = false,
  href,
  title,
  meta,
  className,
}: DashboardRowProps) {
  const body = (
    <>
      {leading && !leadingInteractive && (
        <span aria-hidden className={ROW_BUBBLE}>
          {leading}
        </span>
      )}
      <div className="min-w-0 flex-1">
        {/* WRAPS, never truncates. A single truncated line put "Use higgsfield
            as it is free for 20-30 days" out at "Use higgsfield…". Clamped at
            two lines so a pathological title can't run the row off screen. */}
        <span className="line-clamp-2 text-sm font-semibold text-foreground transition-colors group-hover:text-accent">
          {title}
        </span>
        {/* space-inside (8): the title and its meta line are one object.
            IT WRAPS, IT DOES NOT TRUNCATE. `truncate` here cut the real row
            "3 DAYS OVERDUE · MEDIUM · DAILY" off at "· DAI…" — uppercase plus
            0.1em tracking is wide, and three segments do not fit 375px minus
            the leading glyph and two 16px insets. Truncating a state line
            silently deletes state, and the recurrence segment is the one that
            falls off the end. Height is the cheaper thing to spend. */}
        {meta && <div className="mt-2">{meta}</div>}
      </div>
    </>
  );

  // space-around (16) on every side.
  const bodyClass = "flex min-w-0 flex-1 items-center gap-4 py-4 pr-4 pl-4";

  /**
   * THE PRIORITY ACCENT BAR IS GONE.
   *
   * It was a 2px coloured left rule, and it had to live on this inner wrapper
   * rather than the <li> so that CSS wouldn't miter it against the <li>'s own
   * divider and render a run of same-priority rows as one unbroken rail. All
   * of that machinery is deleted with the bar.
   *
   * Two reasons it went. It duplicated information the meta line already
   * states as a word ("MEDIUM"), and on the real one-row day it rendered as a
   * tall coloured slab that was the loudest object on the screen — it only
   * ever looked balanced in fixture shots with four rows stacked up.
   *
   * Priority now tints the stroke of the tap-to-complete circle, which is
   * already on every row. That gives the colour scan a home without adding an
   * object, and a stroke is not a surface, so it stays inside the direction.
   *
   * Consequence: the `divide-y divide-border` hazard no longer bites here —
   * the colour utility used to outrank `border-l-*` and strip the accent from
   * every row after the first. `divide-y` ALONE is still correct on the <ul>;
   * do not add `divide-border` back.
   */
  return (
    <li className={cn("group", className)}>
      <div className="flex items-center">
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
      </div>
    </li>
  );
}
