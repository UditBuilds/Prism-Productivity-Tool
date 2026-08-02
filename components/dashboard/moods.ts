import type { MoodValue } from "@/types/database";

export interface MoodOption {
  value: MoodValue;
  emoji: string;
  label: string;
}

export const MOODS: MoodOption[] = [
  { value: "great", emoji: "🔥", label: "Great" },
  { value: "good", emoji: "😊", label: "Good" },
  { value: "neutral", emoji: "😐", label: "Neutral" },
  { value: "tired", emoji: "😴", label: "Tired" },
  { value: "stressed", emoji: "😤", label: "Stressed" },
];

export function moodOption(value: MoodValue): MoodOption {
  return MOODS.find((m) => m.value === value) ?? MOODS[2];
}
