import { create } from "zustand";

/**
 * Focus timer state. Pure client state — DB writes (create/complete a
 * focus_sessions row) are done by the components via hooks/useFocus.
 * The 1-second ticker lives in FloatingTimer, which is always mounted in the
 * dashboard layout, so the timer keeps running across page navigation.
 */
interface FocusStore {
  isRunning: boolean;
  isPaused: boolean;
  mode: "focus" | "break";
  /** Countdown ("preset") vs open-ended count-up ("stopwatch"). */
  timerType: "preset" | "stopwatch";
  timeLeft: number; // seconds remaining
  totalDuration: number; // seconds for current mode
  category: string;
  sessionId: string | null;
  /** Seconds actually elapsed (advances only while running & not paused). */
  elapsedSeconds: number;
  /** True right after a focus session naturally hits 0 — drives celebration. */
  justCompleted: boolean;

  startSession: (
    category: string,
    durationMinutes: number,
    timerType?: "preset" | "stopwatch"
  ) => void;
  startBreak: (minutes?: number) => void;
  setSessionId: (id: string | null) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  endSession: () => void;
  /** Mark the running session complete (stopwatch stop) → shows celebration. */
  completeSession: () => void;
  tick: () => void;
  clearCompleted: () => void;
}

export const useFocusStore = create<FocusStore>((set, get) => ({
  isRunning: false,
  isPaused: false,
  mode: "focus",
  timerType: "preset",
  timeLeft: 0,
  totalDuration: 0,
  category: "Study",
  sessionId: null,
  elapsedSeconds: 0,
  justCompleted: false,

  startSession: (category, durationMinutes, timerType = "preset") =>
    set({
      isRunning: true,
      isPaused: false,
      mode: "focus",
      timerType,
      category,
      timeLeft: durationMinutes * 60,
      totalDuration: durationMinutes * 60,
      sessionId: null,
      elapsedSeconds: 0,
      justCompleted: false,
    }),

  startBreak: (minutes = 5) =>
    set({
      isRunning: true,
      isPaused: false,
      mode: "break",
      timerType: "preset",
      timeLeft: minutes * 60,
      totalDuration: minutes * 60,
      sessionId: null,
      elapsedSeconds: 0,
      justCompleted: false,
    }),

  setSessionId: (id) => set({ sessionId: id }),

  pauseTimer: () => set({ isPaused: true }),
  resumeTimer: () => set({ isPaused: false }),

  endSession: () =>
    set({
      isRunning: false,
      isPaused: false,
      timerType: "preset",
      timeLeft: 0,
      totalDuration: 0,
      sessionId: null,
      elapsedSeconds: 0,
      justCompleted: false,
    }),

  completeSession: () =>
    set({ isRunning: false, isPaused: false, justCompleted: true }),

  tick: () => {
    const { isRunning, isPaused, timeLeft, mode, elapsedSeconds, timerType } =
      get();
    if (!isRunning || isPaused) return;
    // Same pause-gated path as the timeLeft decrement: one real second elapsed.
    const nextElapsed = elapsedSeconds + 1;
    // Stopwatch is open-ended: only elapsed advances; it never auto-completes
    // via timeLeft (manual Stop is its natural end — handled in the UI).
    if (timerType === "stopwatch") {
      set({ elapsedSeconds: nextElapsed });
      return;
    }
    if (timeLeft <= 1) {
      set({
        timeLeft: 0,
        isRunning: false,
        isPaused: false,
        justCompleted: mode === "focus",
        elapsedSeconds: nextElapsed,
      });
    } else {
      set({ timeLeft: timeLeft - 1, elapsedSeconds: nextElapsed });
    }
  },

  clearCompleted: () => set({ justCompleted: false, sessionId: null }),
}));

const initialFocusState = useFocusStore.getState();

/**
 * Full reset on logout — without it, one user's still-running timer (and its
 * focus_sessions row id) would keep ticking into the next account's session.
 */
export function resetFocusStore(): void {
  useFocusStore.setState(initialFocusState, true);
}

/** mm:ss display for a seconds value. */
export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
