import { cn } from "@/lib/utils";

/**
 * The dashboard's status zone — the day's check-in and the four counters — in
 * ONE tier-1 container.
 *
 * Why a full-bleed band rather than an inset card (the one stated exception in
 * the dashboard's visual system):
 *
 *   page content width          343px  (375 − 2 × 16px gutter)
 *   Day Rail intrinsic width     81px  (7 cells × 9px + 6 gaps × 3px)
 *   widest cell label         75.61px  ("DUE TODAY" / "REMINDERS")
 *
 * Four counter columns need `4c + 3g ≤ 343 − 2P` with `c ≥ 81`, which reduces
 * to `2P + 3g ≤ 19`. A single pair of 16px insets is already 32px, so there is
 * no gap value that lets the strip sit inside a normally-padded card at 375px
 * — the rail clips. Bleeding to the viewport edge and re-applying the page
 * gutter as the band's own padding keeps the columns at their measured 82.75px
 * and the rail whole, and puts the band's content on x=16, the same vertical
 * line every section header sits on.
 *
 * From `sm:` up the constraint disappears (columns are ~141px), so the band
 * becomes an ordinary inset card and the page reads as one family again.
 */
export function StatusBand({
  checkIn,
  counters,
  className,
}: {
  /** The mood check-in row — a client island. */
  checkIn: React.ReactNode;
  /** The four-across counter grid. */
  counters: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "-mx-4 border-y border-border bg-surface px-4 py-4",
        "sm:mx-0 sm:rounded-xl sm:border-x",
        className
      )}
    >
      {/* Two groups, one container: the hairline says "related, but not the
          same thing", and space-around (16) sits either side of it.
          The rule is applied via `* + *` rather than hard-coded on the counter
          block because MoodWidget renders NOTHING until its query resolves —
          a fixed divider would hang there alone on first paint. With no DOM
          node above it, the counters simply become the first child and the
          divider never applies. */}
      <div className="[&>*+*]:mt-4 [&>*+*]:border-t [&>*+*]:border-border [&>*+*]:pt-4">
        {checkIn}
        {counters}
      </div>
    </section>
  );
}
