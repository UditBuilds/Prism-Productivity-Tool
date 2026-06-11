import type { Metadata } from "next";

export const metadata: Metadata = { title: "Focus | Prism" };

export default function FocusLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
