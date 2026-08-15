import type { Metadata } from "next";

export const metadata: Metadata = { title: "Workout | Prism" };

export default function WorkoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
