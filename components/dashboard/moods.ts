import type { MoodValue } from "@/types/database";

export interface MoodOption {
  value: MoodValue;
  emoji: string;
  label: string;
  color: string;
}

export const MOODS: MoodOption[] = [
  { value: "great", emoji: "🔥", label: "Great", color: "text-emerald-400" },
  { value: "good", emoji: "😊", label: "Good", color: "text-blue-400" },
  { value: "neutral", emoji: "😐", label: "Neutral", color: "text-gray-400" },
  { value: "tired", emoji: "😴", label: "Tired", color: "text-amber-400" },
  { value: "stressed", emoji: "😤", label: "Stressed", color: "text-rose-400" },
];

export function moodOption(value: MoodValue): MoodOption {
  return MOODS.find((m) => m.value === value) ?? MOODS[2];
}
