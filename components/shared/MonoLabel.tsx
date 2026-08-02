import { cn } from "@/lib/utils";

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
