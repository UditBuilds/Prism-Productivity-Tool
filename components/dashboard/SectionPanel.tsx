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
   * - `block` — the dashboard's single-level block. See below.
   *
   * WHY `block` EXISTS AND IS NOT JUST `card`. De-boxing the dashboard (the
   * `plain` note below) removed the repetition, but it also removed every cue
   * that a section ENDS — with only 32px of background between them, a long
   * agenda and the readout under it read as one continuous column. `block`
   * puts each section's body back inside one contained surface while the
   * HEADER stays outside on the page background. That is the whole distinction
   * from the nested-card direction that was rejected: the header is not inside
   * the box, so nothing is a card within a card.
   *
   * It differs from `card` in two measured ways, and both matter:
   *
   *   `[&>ul]:-m-4` — a list body's rows already carry their own 16px inset.
   *   Under `card`'s bare `p-4` the block adds a SECOND 16 above the first row
   *   and below the last, and that doubled padding reads as a void at both
   *   ends of the list. The negative margin cancels it, so the block hugs its
   *   rows. Measured: agenda 134px -> 102px, Revisit 271px -> 239px (-32 each,
   *   exactly the two 16s). The selector is a DIRECT-child one on purpose —
   *   Training's body is a <p> plus a <div>, so its list is a grandchild, it
   *   never matches, and Training keeps the p-4 that its non-list content
   *   needs.
   *
   *   `rounded-sm` — 8px, against `card`'s 12px. NOTE for anyone tuning this:
   *   `rounded-lg` is a no-op here. tailwind.config maps lg to var(--radius) =
   *   0.75rem, which is byte-identical to the default `rounded-xl`. The real
   *   tighter step in this project is `rounded-sm` = calc(var(--radius) - 4px).
   *
   * WHY THE FILL AND BORDER ARE LITERAL VALUES AND NOT `bg-surface`/`border-
   * border`. The block first shipped on the tokens and read as barely there.
   * The reason turned out to be measurable rather than a matter of taste:
   *
   *     --background #0F1012  ->  --surface #17181C   =  1.073 : 1
   *
   * WCAG's floor for non-text contrast is 3:1, so the token step is not a weak
   * signal, it is very close to no signal. `--surface-raised` only reaches
   * 1.157:1, which is why the "step it up one tier" attempt also failed to
   * register. Four strengths were rendered and judged; these are the pair that
   * was picked:
   *
   *     fill    hsl(228 10% 19%)  #2C2E35  =  1.404 : 1 against --background
   *     border  hsl(224 10% 32%)  #494E5A  =  2.285 : 1 against --background
   *
   * Both stay inside the graphite family (hue 224-228, sat 10%), so neither
   * introduces a new colour into the system.
   *
   * They are LITERALS ON PURPOSE, and they live here — once — rather than at
   * the call sites. Raising `--surface` itself would move every surface in the
   * app: `bg-surface` appears 81 times across 63 files and `bg-surface-raised`
   * 108 times across 46 files, which is a redesign of Prism's depth vocabulary
   * rather than a dashboard change. Promoting these to tokens is a separate
   * decision to be taken with the other pages in view.
   *
   * KNOWN CONSEQUENCE — the elevation vocabulary inverts INSIDE a block. At
   * 1.404:1 this fill is brighter than `--surface-raised` (1.157:1), so any
   * tier-2 element nested in a block renders DARKER than its container. On the
   * populated path nothing does: the dashboard rows carry no `bg-` class at
   * all. The one exception is `EmptyState`, which draws `bg-surface` with a
   * `bg-surface-raised` icon circle and appears on the error branch of all
   * three sections. It reads as a recess rather than a raise there. Left as-is
   * deliberately, and rendered rather than assumed.
   *
   * The `card` variant is deliberately left untouched so the Workout page,
   * which is its only caller, stays byte-identical.
   *
   * The dashboard previously used `plain` for all of its sections. Wrapping
   * each one in an identical bordered card made four different kinds of
   * content — a task list, a readout, a schedule, saved notes — look like four
   * instances of one widget, and that repetition (not the content) is what
   * read as a stack of boxes. `block` is the answer to the opposite problem;
   * if it ever reads as a widget stack again, that is the trade to revisit.
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
  variant?: "card" | "plain" | "block";
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
        // The refined heading rank. Applied here rather than inside
        // SectionHeader so the four pages that use that component directly
        // stay byte-identical — the same local-override convention this
        // component already uses for the header's spacing.
        titleClassName="tracking-heading"
      />
      {variant === "plain" ? (
        children
      ) : variant === "block" ? (
        <div className="rounded-sm border border-[hsl(224_10%_32%)] bg-[hsl(228_10%_19%)] p-4 [&>ul]:-m-4">
          {children}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface p-4">
          {children}
        </div>
      )}
    </section>
  );
}
