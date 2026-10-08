"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTheme } from "@/components/providers/ThemeProvider";
import type { ColorMode } from "@/lib/color-mode";

const OPTIONS: { mode: ColorMode; label: string; icon: LucideIcon }[] = [
  { mode: "system", label: "System", icon: Monitor },
  { mode: "light", label: "Light", icon: Sun },
  { mode: "dark", label: "Dark", icon: Moon },
];

/** Light / dark / follow the device. Sits beside the accent picker. */
export function AppearanceCard() {
  const { colorMode, setColorMode } = useTheme();

  return (
    <div className="mt-5 max-w-lg rounded-xl border border-border bg-surface p-6">
      <h2
        id="appearance-heading"
        className="text-base font-semibold text-foreground"
      >
        Appearance
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Dark, light, or follow your device. Applies instantly on this device.
      </p>

      <div
        role="group"
        aria-labelledby="appearance-heading"
        className="mt-5 grid grid-cols-3 gap-2"
      >
        {OPTIONS.map(({ mode, label, icon: Icon }) => {
          const selected = colorMode === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setColorMode(mode)}
              aria-pressed={selected}
              className={cn(
                "flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-medium",
                selected
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-border bg-surface-raised text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
