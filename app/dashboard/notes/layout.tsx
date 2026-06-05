import type { Metadata } from "next";

export const metadata: Metadata = { title: "Notes | Prism" };

export default function NotesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
