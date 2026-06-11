"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Square } from "lucide-react";

import { useFocusStore, formatClock } from "@/store/focus.store";
import { useEndFocusSession } from "@/hooks/useFocus";
import { CATEGORIES } from "@/components/focus/categories";

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

      // Natural completion (hit 0)
      if (after.timeLeft === 0 && !after.isRunning) {
        if (before.mode === "focus") {
          if (after.sessionId) {
            endMutationRef.current.mutate({
              id: after.sessionId,
              completed: true,
            });
          }
          try {
            if (
              typeof Notification !== "undefined" &&
              Notification.permission === "granted"
            ) {
              new Notification(
                `${before.category} session complete! Well done.`,
                { icon: "/icons/icon-192.png" }
              );
            }
          } catch {
            // Notifications unsupported — toast below still fires.
          }
          toast.success(`${before.category} session complete! 🎉`);
        } else {
          toast(`Break over — back to it.`, { icon: "⏰" });
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  function handleEnd() {
    const { sessionId } = useFocusStore.getState();
    if (sessionId) {
      endMutationRef.current.mutate({ id: sessionId, completed: false });
    }
    endSession();
  }

  // Only show the widget while running, away from the focus page.
  if (!isRunning || pathname === "/dashboard/focus") return null;

  const emoji =
    mode === "break"
      ? "☕"
      : CATEGORIES.find((c) => c.label === category)?.emoji ?? "🎯";

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
