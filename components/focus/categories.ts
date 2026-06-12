export interface FocusCategory {
  label: string;
  emoji: string;
  /** Pill classes when this category is selected (static for Tailwind JIT). */
  activeClass: string;
  /** Stable hex for charts — matches the category's Tailwind hue (…-500). */
  chartColor: string;
}

export const CATEGORIES: FocusCategory[] = [
  {
    label: "Study",
    emoji: "📚",
    activeClass: "border-violet-500 bg-violet-500/15 text-violet-300",
    chartColor: "#8B5CF6",
  },
  {
    label: "Work",
    emoji: "💼",
    activeClass: "border-blue-500 bg-blue-500/15 text-blue-300",
    chartColor: "#3B82F6",
  },
  {
    label: "Reading",
    emoji: "📖",
    activeClass: "border-emerald-500 bg-emerald-500/15 text-emerald-300",
    chartColor: "#10B981",
  },
  {
    label: "Exercise",
    emoji: "🏃",
    activeClass: "border-amber-500 bg-amber-500/15 text-amber-300",
    chartColor: "#F59E0B",
  },
  {
    label: "Deep Work",
    emoji: "🎯",
    activeClass: "border-rose-500 bg-rose-500/15 text-rose-300",
    chartColor: "#F43F5E",
  },
];

/** Chart color for a category label (stable gray fallback for unknowns). */
export function categoryChartColor(label: string): string {
  return CATEGORIES.find((c) => c.label === label)?.chartColor ?? "#6B7280";
}

export const DURATIONS = [25, 45, 60, 90] as const;
