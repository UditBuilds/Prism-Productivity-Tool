"use client";

import { Check } from "lucide-react";

import { THEMES, useTheme } from "@/components/providers/ThemeProvider";

export function ThemeCard() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="mt-5 max-w-lg rounded-xl border border-border bg-surface p-6">
      <h2 className="text-base font-semibold text-foreground">Accent Color</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick the accent used across PRISM. Applies instantly on this device.
      </p>

      <div className="mt-5 flex flex-wrap gap-3">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTheme(t.id)}
            aria-label={`${t.label} accent`}
            aria-pressed={theme === t.id}
            title={t.label}
            className="flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-110 active:scale-95"
            style={{ backgroundColor: t.hex }}
          >
            {theme === t.id && <Check className="h-4 w-4 text-white" />}
          </button>
        ))}
      </div>
    </div>
  );
}
