export interface FocusCategory {
  label: string;
  emoji: string;
  /** Pill classes when this category is selected (static for Tailwind JIT). */
  activeClass: string;
}

export const CATEGORIES: FocusCategory[] = [
  {
    label: "Study",
    emoji: "📚",
    activeClass: "border-violet-500 bg-violet-500/15 text-violet-300",
  },
  {
    label: "Work",
    emoji: "💼",
    activeClass: "border-blue-500 bg-blue-500/15 text-blue-300",
  },
  {
    label: "Reading",
    emoji: "📖",
    activeClass: "border-emerald-500 bg-emerald-500/15 text-emerald-300",
  },
  {
    label: "Exercise",
    emoji: "🏃",
    activeClass: "border-amber-500 bg-amber-500/15 text-amber-300",
  },
  {
    label: "Deep Work",
    emoji: "🎯",
    activeClass: "border-rose-500 bg-rose-500/15 text-rose-300",
  },
];

export const DURATIONS = [25, 45, 60, 90] as const;
