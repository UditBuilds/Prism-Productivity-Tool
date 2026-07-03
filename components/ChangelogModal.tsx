"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

import pkg from "@/package.json";
import { onboardingComplete } from "@/components/onboarding/WelcomeWizard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "prism-changelog-version";
const appVersion = pkg.version;

const CHANGELOG: { version: string; note: string }[] = [
  {
    version: "v0.2.0",
    note: "Fresh new design with gradients, glass-morphism, and animations",
  },
  {
    version: "v0.1.9",
    note: "Improved notification reliability + onboarding wizard",
  },
  {
    version: "v0.1.8",
    note: "Recurring daily tasks with custom day patterns",
  },
  {
    version: "v0.1.7",
    note: "Weekly review, calendar view, and productivity analytics",
  },
  {
    version: "v0.1.6",
    note: "Focus timer with stopwatch mode and custom categories",
  },
];

/**
 * "What's new" modal, shown once per app version (localStorage). Suppressed
 * for brand-new users: while onboarding is pending we stamp the current
 * version instead — they're already on the latest and just saw the wizard.
 */
export function ChangelogModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (seen === appVersion) return;
      if (!onboardingComplete()) {
        localStorage.setItem(STORAGE_KEY, appVersion);
        return;
      }
      setOpen(true);
    } catch {
      // Storage unavailable — skip quietly.
    }
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, appVersion);
    } catch {
      // Ignore.
    }
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 animate-breathe text-accent" />
            What&apos;s new in Prism
          </DialogTitle>
          <DialogDescription>
            You&apos;re on v{appVersion}. Here&apos;s what changed recently.
          </DialogDescription>
        </DialogHeader>

        <ul className="stagger-children space-y-2">
          {CHANGELOG.map((entry) => (
            <li
              key={entry.version}
              className="flex items-start gap-3 rounded-xl border border-border bg-surface-raised/50 px-4 py-3"
            >
              <span className="text-gradient shrink-0 font-mono text-xs font-semibold leading-5">
                {entry.version}
              </span>
              <span className="text-sm text-foreground">{entry.note}</span>
            </li>
          ))}
        </ul>

        <Button className="w-full rounded-lg" onClick={dismiss}>
          Got it
        </Button>
      </DialogContent>
    </Dialog>
  );
}
