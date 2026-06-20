"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Square } from "lucide-react";

import { useFocusStore, formatClock } from "@/store/focus.store";
import { useEndFocusSession } from "@/hooks/useFocus";
import { useFocusCategories } from "@/hooks/useFocusCategories";

/**
 * Short completion chime (~0.3s) synthesised with the Web Audio API — no audio
 * file required. Best-effort: silently no-ops if Web Audio is unavailable or
 * blocked. The user started the timer with a click, so the page already has the
 * activation Web Audio needs.
 */
function playChime() {
  try {
    const w = window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioCtor = window.AudioContext ?? w.webkitAudioContext;
    if (!AudioCtor) return;

    const ctx = new AudioCtor();
    void ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now); // A5
    osc.frequency.setValueAtTime(1318.5, now + 0.15); // → E6, a soft "ding-dong"

    // Quick attack + smooth exponential decay so the tone doesn't click.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.32);
    osc.onended = () => {
      void ctx.close();
    };
  } catch {
    // Web Audio unsupported or blocked — the completion toast still fires.
  }
}

/**
 * Always mounted in the dashboard layout. Owns the 1-second ticker (so the
 * timer survives page navigation) and the completion side effects
 * (notification + DB update). Renders the floating mini-widget only when a
 * session is running away from /dashboard/focus.
 */
export function FloatingTimer() {
  const pathname = usePathname();
  const router = useRouter();
  const endFocusSession = useEndFocusSession();
  const { categories } = useFocusCategories();

  const isRunning = useFocusStore((s) => s.isRunning);
  const isPaused = useFocusStore((s) => s.isPaused);
  const timeLeft = useFocusStore((s) => s.timeLeft);
  const mode = useFocusStore((s) => s.mode);
  const category = useFocusStore((s) => s.category);
  const endSession = useFocusStore((s) => s.endSession);

  // Keep the mutation in a ref so the interval effect never re-subscribes.
  const endMutationRef = useRef(endFocusSession);
  endMutationRef.current = endFocusSession;

  // The single global ticker + completion handler.
  useEffect(() => {
    const interval = setInterval(() => {
      const before = useFocusStore.getState();
      if (!before.isRunning || before.isPaused) return;
      before.tick();
      const after = useFocusStore.getState();

      // Heartbeat: persist elapsed every 20s while genuinely running. Piggybacks
      // on this existing tick — no second interval. Fire-and-forget: a missed
      // beat must never disrupt the running timer (swallow failures, no UI).
      if (
        after.elapsedSeconds % 20 === 0 &&
        after.isRunning &&
        !after.isPaused &&
        after.sessionId
      ) {
        void fetch("/api/focus", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: after.sessionId,
            elapsed_seconds: after.elapsedSeconds,
          }),
        }).catch((err) => {
          console.warn("Focus heartbeat failed:", err);
        });
      }

      // Natural completion (hit 0)
      if (after.timeLeft === 0 && !after.isRunning) {
        if (before.mode === "focus") {
          if (after.sessionId) {
            // elapsed_seconds rides along on the existing completion PATCH
            // (assigned to a var so the extra field stays assignable to the
            // mutation's { id, completed } input type).
            const completionPayload = {
              id: after.sessionId,
              completed: true,
              elapsed_seconds: after.elapsedSeconds,
            };
            endMutationRef.current.mutate(completionPayload);
          }

          const message = before.category
            ? `${before.category} session complete 🎉`
            : "Focus session complete 🎉";

          // Always: chime + toast, so a user watching the page gets clear,
          // hard-to-miss feedback the moment the countdown hits zero.
          playChime();
          toast.success(message);

          // Additionally, when the tab is backgrounded AND notification
          // permission is already granted, surface a browser Notification.
          // Check only — never request a new permission prompt here.
          try {
            if (
              document.hidden &&
              typeof Notification !== "undefined" &&
              Notification.permission === "granted"
            ) {
              new Notification(message, {
                body: "Well done — that's real progress.",
                icon: "/icons/icon-192.png",
              });
            }
          } catch {
            // Notifications unsupported/blocked — chime + toast already fired.
          }
        } else {
          toast(`Break over — back to it.`, { icon: "⏰" });
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  function handleEnd() {
    const { sessionId, elapsedSeconds } = useFocusStore.getState();
    if (sessionId) {
      // Var so the extra elapsed_seconds stays assignable to the mutation's
      // { id, completed } input type (no excess-property error).
      const stopPayload = {
        id: sessionId,
        completed: false,
        elapsed_seconds: elapsedSeconds,
      };
      endMutationRef.current.mutate(stopPayload);
    }
    endSession();
  }

  // Only show the widget while running, away from the focus page.
  if (!isRunning || pathname === "/dashboard/focus") return null;

  const emoji =
    mode === "break"
      ? "☕"
      : categories.find((c) => c.label === category)?.emoji ?? "🎯";

  return (
    <div className="fixed left-1/2 top-[calc(env(safe-area-inset-top)_+_0.5rem)] z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-accent/30 bg-[#111111]/95 py-1 pl-1 pr-1 shadow-lg shadow-black/40 backdrop-blur-xl sm:bottom-6 sm:left-auto sm:right-6 sm:top-auto sm:translate-x-0">
      <button
        type="button"
        onClick={() => router.push("/dashboard/focus")}
        aria-label="Open focus timer"
        className="flex items-center gap-2.5 rounded-full py-1 pl-3 pr-1 hover:bg-surface-raised"
      >
        <span aria-hidden>{emoji}</span>
        <span
          className={`text-sm font-semibold tabular-nums ${
            isPaused ? "text-muted-foreground" : "text-accent"
          }`}
        >
          {formatClock(timeLeft)}
        </span>
      </button>
      <button
        type="button"
        aria-label="End session"
        onClick={handleEnd}
        className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-danger/15 hover:text-danger"
      >
        <Square className="h-3 w-3 fill-current" />
      </button>
    </div>
  );
}
