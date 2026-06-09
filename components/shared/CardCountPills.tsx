"use client";

import { cn } from "@/lib/utils";

/** A row of pill buttons for picking how many cards to generate. */
export function CardCountPills({
  value,
  onChange,
  options,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  options: number[];
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onChange(n)}
          aria-pressed={value === n}
          className={cn(
            "min-w-[2.75rem] rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
            value === n
              ? "bg-accent text-accent-foreground"
              : "border border-border bg-surface-raised text-muted-foreground hover:text-foreground"
          )}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
