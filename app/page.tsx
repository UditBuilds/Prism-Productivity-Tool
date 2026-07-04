import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata = {
  title: "Prism — Remember everything you learn",
  description:
    "Tasks, notes, and AI-powered spaced repetition in one tool. Drop in a PDF, a YouTube link, or your own notes — Prism turns them into flashcards scheduled with the SM-2 algorithm.",
};

// Real star count for the trust bar — cached an hour, and the page renders
// fine without it (returns null on any failure; no fake numbers).
async function getGithubStars(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.github.com/repos/UditBuilds/Prism-Productivity-Tool",
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { stargazers_count?: number };
    return typeof json.stargazers_count === "number"
      ? json.stargazers_count
      : null;
  } catch {
    return null;
  }
}

// Root entry: authenticated users go straight to the dashboard;
// unauthenticated visitors get the landing page (middleware only guards
// /dashboard, so / is publicly reachable).
export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/dashboard");

  const stars = await getGithubStars();
  return <LandingPage stars={stars} />;
}
