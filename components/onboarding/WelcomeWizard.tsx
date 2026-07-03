"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  Bell,
  Brain,
  CheckCircle2,
  CheckSquare,
  Loader2,
  Timer,
} from "lucide-react";

import { usePushSubscription } from "@/hooks/usePushSubscription";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const STORAGE_KEY = "prism-onboarding-complete";

/** True once the user has finished (or dismissed) the welcome wizard. */
export function onboardingComplete(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return true; // storage unavailable → never nag
  }
}

/**
 * 3-step first-run wizard, shown once per device (localStorage flag).
 * Dismissing it any way — finish, Escape, overlay click — sets the flag, so it
 * never re-opens.
 */
export function WelcomeWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const { subscribe } = usePushSubscription();

  // Client-only check after mount (localStorage doesn't exist during SSR).
  useEffect(() => {
    if (!onboardingComplete()) setOpen(true);
  }, []);

  function finish() {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Storage unavailable — the wizard may show again next visit; harmless.
    }
    setOpen(false);
  }

  // The Enable button tap is the user gesture iOS requires for the permission
  // prompt. Whatever the outcome, move on to the final step.
  async function enableNotifications() {
    setBusy(true);
    try {
      if (typeof Notification !== "undefined") {
        const result = await Notification.requestPermission();
        if (result === "granted") {
          void subscribe();
          toast.success("Notifications enabled");
        }
      }
    } catch {
      // Ignore — the Settings page offers a retry path.
    } finally {
      setBusy(false);
      setStep(2);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && finish()}>
      <DialogContent className="sm:max-w-md">
        {step === 0 && (
          <div className="flex animate-fade-up flex-col items-center py-4 text-center">
            <DialogTitle className="text-gradient-animated text-3xl font-bold tracking-tight drop-shadow-[0_0_16px_rgb(var(--accent-rgb)/0.35)]">
              PRISM
            </DialogTitle>
            <p className="mt-2 text-sm text-muted-foreground">
              Your AI-native productivity system
            </p>

            <ul className="stagger-children mt-7 w-full space-y-3 text-left">
              <li className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised/50 px-4 py-3">
                <CheckSquare className="h-5 w-5 shrink-0 text-accent" />
                <span className="text-sm text-foreground">
                  Tasks + notes, organized in one place
                </span>
              </li>
              <li className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised/50 px-4 py-3">
                <Brain className="h-5 w-5 shrink-0 text-accent" />
                <span className="text-sm text-foreground">
                  AI flashcards with spaced repetition
                </span>
              </li>
              <li className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised/50 px-4 py-3">
                <Timer className="h-5 w-5 shrink-0 text-accent" />
                <span className="text-sm text-foreground">
                  Focus timer for deep work sessions
                </span>
              </li>
            </ul>

            <Button className="mt-7 w-full rounded-lg" onClick={() => setStep(1)}>
              Next
            </Button>
          </div>
        )}

        {step === 1 && (
          <div className="flex animate-fade-up flex-col items-center py-4 text-center">
            <div className="flex h-14 w-14 animate-pulse-ring items-center justify-center rounded-full border border-accent/30 bg-accent/10">
              <Bell className="h-6 w-6 animate-bell-ring-loop text-accent" />
            </div>
            <DialogTitle className="mt-5 text-lg font-semibold tracking-tight text-foreground">
              Enable notifications
            </DialogTitle>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground">
              Prism works best with notifications. Get reminded about tasks and
              reviews even when the tab is closed.
            </p>
            <Button
              className="mt-6 w-full rounded-lg"
              disabled={busy}
              onClick={enableNotifications}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enable notifications
            </Button>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="mt-3 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Skip for now
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="flex animate-fade-up flex-col items-center py-4 text-center">
            <CheckCircle2 className="h-14 w-14 animate-pop text-success drop-shadow-[0_0_20px_rgb(16_185_129/0.4)]" />
            <DialogTitle className="text-gradient mt-5 text-lg font-semibold tracking-tight">
              You&apos;re all set
            </DialogTitle>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground">
              Start by adding a task or creating your first flashcard deck.
            </p>
            <Button className="mt-6 w-full rounded-lg" onClick={finish}>
              Go to dashboard
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
