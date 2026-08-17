import { cn } from "@/lib/utils";

/**
 * The dashboard's status zone — the four counters.
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
 * The type direction deletes the rail (TRAINED now states "1/7 days" as text),
 * which deletes the 81px floor, which deletes the reason for the workaround.
 * The band is an ordinary section again.
 *
 * The columns do not change width. `-mx-4 … px-4` was re-applying exactly the
 * gutter it had just cancelled, so its content box was already 343px — the same
 * 343px an ordinary section gets. Four columns at `gap-1` are 82.75px either
 * way. Removing the bleed moves nothing horizontally; it only removes the
 * surface, the two hairlines, and the `sm:` branch that existed to undo them.
 *
 * It is kept as a component rather than inlined because it is the one place
 * that owns how the counter row meets the page margins — which is precisely the
 * axis the symmetry variants explore.
 */
export function StatusBand({
  counters,
  className,
}: {
  /** The four-across counter grid. */
  counters: React.ReactNode;
  className?: string;
}) {
  return <section className={cn(className)}>{counters}</section>;
}
