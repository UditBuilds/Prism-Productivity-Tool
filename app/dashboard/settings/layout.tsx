import type { Metadata } from "next";

export const metadata: Metadata = { title: "Settings | Prism" };

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
