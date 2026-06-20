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
  timeLeft: number; // seconds remaining
  totalDuration: number; // seconds for current mode
  category: string;
  sessionId: string | null;
  /** Seconds actually elapsed (advances only while running & not paused). */
  elapsedSeconds: number;
  /** True right after a focus session naturally hits 0 — drives celebration. */
  justCompleted: boolean;

  startSession: (category: string, durationMinutes: number) => void;
  startBreak: (minutes?: number) => void;
  setSessionId: (id: string | null) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  endSession: () => void;
  tick: () => void;
  clearCompleted: () => void;
}

export const useFocusStore = create<FocusStore>((set, get) => ({
  isRunning: false,
  isPaused: false,
  mode: "focus",
  timeLeft: 0,
  totalDuration: 0,
  category: "Study",
  sessionId: null,
  elapsedSeconds: 0,
  justCompleted: false,

  startSession: (category, durationMinutes) =>
    set({
      isRunning: true,
      isPaused: false,
      mode: "focus",
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
      timeLeft: 0,
      totalDuration: 0,
      sessionId: null,
      elapsedSeconds: 0,
      justCompleted: false,
    }),

  tick: () => {
    const { isRunning, isPaused, timeLeft, mode, elapsedSeconds } = get();
    if (!isRunning || isPaused) return;
    // Same pause-gated path as the timeLeft decrement: one real second elapsed.
    const nextElapsed = elapsedSeconds + 1;
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

/** mm:ss display for a seconds value. */
export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
