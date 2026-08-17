import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/shared/SectionHeader";

/**
 * A section: rank-1 header, then its body. Every dashboard content section
 * (Due Today, Workout, Upcoming, Revisit) and both Workout-page sections go
 * through here, so the page cannot drift back into six different section gaps
 * and three padding regimes.
 *
 * The system it enforces:
 *   space-between (32)  section -> section          — owned by the page
 *   space-around  (16)  header -> body, card padding
 *   space-inside  (8)   row -> row inside the body
 *
 * WHY TWO VARIANTS AND NOT THREE. This used to offer `card` / `list` / `bare`,
 * where `list` was a card with no padding (rows partitioned it edge to edge)
 * and `bare` was no card at all. Once the dashboard's four sections were
 * de-boxed, `list` had no call sites left — a card with no padding, no
 * background and no border is just `plain`. `bare` and `list` therefore
 * collapsed into one honest option.
 *
 * SectionHeader's own `mb-3` / `gap-2.5` are overridden here rather than
 * changed at source: Focus, Learn and Weekly Review share that component and
 * are outside this change.
 */
export function SectionPanel({
  title,
  count,
  countPlain,
  href,
  linkLabel,
  action,
  /**
   * Whether the body gets a container of its own.
   *
   * - `card` — tier-1 card, 16px padding. For a body that is ONE object: the
   *   Workout page's log form, its day's sets. The card is doing real work
   *   there, because those bodies are a form and a grouped list that need to
   *   read as single objects on a page dedicated to them.
   * - `plain` — no container. The body sits directly on the page background;
   *   rows carry their own 16 and separate with hairlines, and an EmptyState
   *   draws its own dashed surface.
   *
   * The dashboard uses `plain` for all four of its sections. Wrapping each one
   * in an identical bordered card made four different kinds of content — a
   * task list, a readout, a schedule, saved notes — look like four instances
   * of one widget, and that repetition (not the content) is what read as a
   * stack of boxes. Separation now comes from the 32 between sections and the
   * header's own weight and accent bar.
   */
  variant = "card",
  children,
  className,
}: {
  title: string;
  count?: number;
  /** Render the count as bare mono text rather than a filled pill. */
  countPlain?: boolean;
  href?: string;
  linkLabel?: string;
  action?: React.ReactNode;
  variant?: "card" | "plain";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-8", className)}>
      <SectionHeader
        title={title}
        count={count}
        countPlain={countPlain}
        href={href}
        linkLabel={linkLabel}
        action={action}
        accentBar
        className="mb-4 gap-2"
      />
      {variant === "plain" ? (
        children
      ) : (
        <div className="rounded-xl border border-border bg-surface p-4">
          {children}
        </div>
      )}
    </section>
  );
}
