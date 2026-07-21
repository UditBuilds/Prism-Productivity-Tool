import { cn } from "@/lib/utils";

export interface DayRailCell {
  /** Activity happened this day → filled cell. */
  filled: boolean;
  /** Today's cell — outlined in the rail hue when not filled. */
  isToday?: boolean;
  /** Dimmed cell (e.g. future days of the current week). */
  dim?: boolean;
}

export interface DayRailProps {
  /** One cell per IST civil day, oldest → newest. */
  days: DayRailCell[];
  /** Fill for active cells, e.g. "bg-success". */
  fillClassName?: string;
  /** Border for today's outlined cell, e.g. "border-success". */
  outlineClassName?: string;
  /** Accessible summary, e.g. "3 of 7 days active". Omit for aria-hidden. */
  label?: string;
  className?: string;
}

/**
 * Day Rail — the design system's signature element: one 9px cell per IST civil
 * day. Filled = activity in the module's hue, hollow = empty day, today =
 * outlined. Presentational and server-safe; callers derive the cells from the
 * same IST day indexes the rest of the app already computes.
 */
export function DayRail({
  days,
  fillClassName = "bg-accent",
  outlineClassName = "border-accent",
  label,
  className,
}: DayRailProps) {
  return (
    <div
      className={cn("flex items-center gap-[3px]", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {days.map((d, i) => (
        <span
          key={i}
          className={cn(
            "h-[9px] w-[9px] rounded-[2.5px] border-[1.5px]",
            d.filled
              ? cn(fillClassName, "border-transparent")
              : d.isToday
                ? cn("bg-transparent", outlineClassName)
                : "border-border-col bg-transparent",
            d.dim && "opacity-40"
          )}
        />
      ))}
    </div>
  );
}
