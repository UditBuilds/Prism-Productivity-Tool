import type { Metadata } from "next";

export const metadata: Metadata = { title: "Learn | Prism" };

export default function LearnLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
