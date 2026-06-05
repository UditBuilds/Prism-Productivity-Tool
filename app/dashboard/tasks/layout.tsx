import type { Metadata } from "next";

export const metadata: Metadata = { title: "Tasks | Prism" };

export default function TasksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
