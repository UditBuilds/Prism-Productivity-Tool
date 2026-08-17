import { cn } from "@/lib/utils";

/**
 * The dashboard's REFINED label rank: heavier and set wider than the shared
 * default.
 *
 * Opt-in rather than baked into MonoLabel, because this component is also the
 * label rank on Focus, Learn, Weekly Review, Calendar and the Workout page —
 * screens outside this change. The same reasoning that gave SectionHeader its
 * `countPlain` flag and made SectionPanel override SectionHeader's spacing
 * locally: the dashboard's type spec is a dashboard rule, not yet app-wide.
 *
 * Pass it as `className`; `cn` is tailwind-merge, so it correctly replaces the
 * base `font-medium` and `tracking-[0.1em]`.
 */
export const MONO_LABEL_REFINED = "font-semibold tracking-label";

/**
 * The mono-caps micro-label — "DAILY CHECK-IN", "DUE TODAY", "REMINDER
 * DELIVERY". One definition for the six sites that used to hand-roll the
 * string; PushHealthBanner diverged with tracking-wider and no font-medium.
 *
 * `as` exists so StatCard can keep its <span> inside a flex row — swapping it
 * for a block <p> would change that card's layout, which is out of scope here.
 */
export function MonoLabel({
  children,
  className,
  as: Tag = "p",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "p" | "span";
}) {
  return (
    <Tag
      className={cn(
        "font-mono text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground",
        className
      )}
    >
      {children}
    </Tag>
  );
}
