import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SectionHeaderProps {
  title: string;
  /** Count pill after the title (hidden when 0/undefined). */
  count?: number;
  /** "View all"-style link on the right. */
  href?: string;
  linkLabel?: string;
  /** Accent bar to the left of the title (dashboard sections). */
  accentBar?: boolean;
  /** Custom right-side slot; wins over href. */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Shared section heading (Dashboard, Focus, Learn, Weekly Review). Gradient
 * title, optional count pill, optional accent bar, one right-side action.
 */
export function SectionHeader({
  title,
  count,
  href,
  linkLabel = "View all",
  accentBar = false,
  action,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn("mb-3 flex items-center gap-2.5", className)}>
      {accentBar && (
        <span
          aria-hidden
          className="h-5 w-0.5 self-center rounded-full bg-accent"
        />
      )}
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-surface-raised px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
      {action ? (
        <div className="ml-auto flex shrink-0 items-center">{action}</div>
      ) : href ? (
        <Link
          href={href}
          className="group ml-auto inline-flex items-center gap-1 text-sm font-medium text-accent hover:text-accent-hover"
        >
          {linkLabel}
          <ArrowRight
            aria-hidden
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
          />
        </Link>
      ) : null}
    </div>
  );
}
