import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata = {
  title: "Prism — Remember everything you learn",
  description:
    "Tasks, notes, and AI-powered spaced repetition in one tool. Drop in a PDF, a YouTube link, or your own notes — Prism turns them into flashcards scheduled with the SM-2 algorithm.",
};

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/dashboard");

  return <LandingPage />;
}
