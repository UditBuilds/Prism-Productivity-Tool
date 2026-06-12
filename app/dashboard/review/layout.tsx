import type { Metadata } from "next";

export const metadata: Metadata = { title: "Weekly Review | Prism" };

export default function ReviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
