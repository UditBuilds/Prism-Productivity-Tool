import { cn } from "@/lib/utils";

/**
 * The dashboard's status zone — the four counters — and the one place that
 * owns how that row meets the page margins.
 *
 * WHY THIS NO LONGER BLEEDS TO THE VIEWPORT EDGE.
 *
 * It used to be a full-bleed tier-1 card (`-mx-4 border-y bg-surface px-4`),
 * and the justification was arithmetic rather than taste:
 *
 *   page content width          343px  (375 − 2 × 16px gutter)
 *   Day Rail intrinsic width     81px  (7 cells × 9px + 6 gaps × 3px)
 *
 * Four columns needed `4c + 3g ≤ 343 − 2P` with `c ≥ 81`, i.e. `2P + 3g ≤ 19`.
 * One pair of 16px insets is already 32px, so NO gap value let the strip sit
 * inside a normally-padded card at 375px — the rail clipped. Bleeding out and
 * re-applying the page gutter as the band's own padding was the workaround.
 *
 * The type direction deletes the rail (TRAINED states "1/7 days" as text),
 * which deletes the 81px floor, which deletes the reason for the workaround.
 *
 * FULL-WIDTH DISTRIBUTION, NOT A FOUR-COLUMN GRID.
 *
 * `justify-between` on content-sized columns, so the row spans the whole
 * measure: OVERDUE's label starts on the page's left margin and OPEN's figure
 * closes against the right one, which puts the band on exactly the same width
 * as every section header below it.
 *
 * Two alternatives were rendered and rejected by looking. A true 25% grid kept
 * the columns equal but ended OPEN well short of the right margin, leaving the
 * band visibly narrower than the headers. Centring inside those quarters read
 * as one unit but pulled OVERDUE off the left margin, so the band no longer
 * lined up with anything on the page.
 *
 * The accepted cost: columns size to their content, so the gaps between them
 * are not equal — TRAINED sits nearer REVIEW than OPEN does to TRAINED. The
 * outer edges are what align, and they are what the eye reads against the
 * headers.
 *
 * `items-start` matters: without it the flex row stretches every column to the
 * tallest and the figures stop sharing a baseline.
 */
export function StatusBand({
  counters,
  className,
}: {
  /** The four counter tiles, in reading order. */
  counters: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex items-start justify-between", className)}>
      {counters}
    </section>
  );
}
