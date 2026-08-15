import { cn } from "@/lib/utils";

/**
 * The dashboard's status zone — the four counters — in ONE tier-1 container.
 *
 * It used to carry the mood check-in above the counters, separated by a
 * hairline. The check-in was removed from the dashboard (the `mood_logs`
 * feature itself is untouched — the Learn page's Mood tab and the Weekly
 * Review still read it), so the `checkIn` prop and the `* + *` divider rule
 * that existed only to separate the two groups are gone with it. One group
 * needs no divider.
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
  counters,
  className,
}: {
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
      {counters}
    </section>
  );
}
