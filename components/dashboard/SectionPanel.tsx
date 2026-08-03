import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/shared/SectionHeader";

/**
 * A dashboard section: rank-1 header on the page background, tier-1 card
 * beneath it. The four content sections (Due Today, Workout, Upcoming,
 * Revisit) all go through here so the page cannot drift back into six
 * different section gaps and three padding regimes.
 *
 * The system it enforces:
 *   space-between (32)  section -> section          — owned by the page
 *   space-around  (16)  header -> body, card padding
 *   space-inside  (8)   row -> row inside the body
 *
 * SectionHeader's own `mb-3` / `gap-2.5` are overridden here rather than
 * changed at source: Focus, Learn and Weekly Review share that component and
 * are outside this change.
 */
export function SectionPanel({
  title,
  count,
  href,
  linkLabel,
  action,
  /**
   * How the body sits in its tier-1 card.
   *
   * - `card` — 16px padding. For a body that is one object (the Workout form).
   * - `list` — NO padding; the rows partition the card edge to edge and carry
   *   the 16 themselves, separated by hairlines rather than gaps.
   * - `bare` — no card at all. An EmptyState draws its own dashed tier-1
   *   surface, and nesting that inside a solid one is two boxes saying one
   *   thing.
   *
   * `list` is not a stylistic preference. Padding the card AND the row insets
   * the row's text twice: 343 − 2×16 (card) − 2×16 (row) leaves a title 32px
   * narrower, which truncated real row titles that used to fit. Rows spanning
   * the full card width put their text back on x=33, exactly where it was.
   */
  variant = "card",
  children,
  className,
}: {
  title: string;
  count?: number;
  href?: string;
  linkLabel?: string;
  action?: React.ReactNode;
  variant?: "card" | "list" | "bare";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-8", className)}>
      <SectionHeader
        title={title}
        count={count}
        href={href}
        linkLabel={linkLabel}
        action={action}
        accentBar
        className="mb-4 gap-2"
      />
      {variant === "bare" ? (
        children
      ) : (
        <div
          className={cn(
            "rounded-xl border border-border bg-surface",
            // overflow-hidden so a square-cornered first/last row is clipped by
            // the card's radius instead of poking through it.
            variant === "list" ? "overflow-hidden" : "p-4"
          )}
        >
          {children}
        </div>
      )}
    </section>
  );
}
