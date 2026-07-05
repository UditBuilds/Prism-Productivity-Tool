import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Tighter paddings for inline panel slots (calendar day panel, widgets). */
  compact?: boolean;
  /** Ambient floating accent dots (dashboard "all clear" celebration). */
  particles?: boolean;
  className?: string;
}

/**
 * Standard empty/error state: dashed card, floating icon, title, description,
 * one action. Used for errors and per-filter empties — first-run full-page
 * empties use the illustrated EmptyShell variants in EmptyStates.tsx.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
  particles = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "relative flex animate-fade-up flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-surface text-center",
        compact ? "px-4 py-8" : "px-6 py-14",
        className
      )}
    >
      {particles && (
        <>
          <span aria-hidden className="particle-dot" style={{ left: "18%", bottom: "20%" }} />
          <span aria-hidden className="particle-dot" style={{ left: "36%", bottom: "10%", animationDelay: "0.9s" }} />
          <span aria-hidden className="particle-dot" style={{ left: "62%", bottom: "16%", animationDelay: "1.7s" }} />
          <span aria-hidden className="particle-dot" style={{ left: "82%", bottom: "24%", animationDelay: "2.4s" }} />
        </>
      )}
      <div
        className={cn(
          "flex animate-float items-center justify-center rounded-full border border-border bg-surface-raised",
          compact ? "h-11 w-11" : "h-12 w-12"
        )}
      >
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className={cn("text-sm font-medium text-foreground", compact ? "mt-3" : "mt-4")}>
        {title}
      </p>
      {description && (
        <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className={compact ? "mt-3" : "mt-5"}>{action}</div>}
    </div>
  );
}
