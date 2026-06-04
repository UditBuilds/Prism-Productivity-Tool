import { createClient } from "@/lib/supabase/server";
import { istDayNumber } from "@/lib/date";
import { LearnClient } from "@/components/srs/LearnClient";

/**
 * Consecutive-day review streak (IST). Counts back from today; if nothing has
 * been reviewed yet today, yesterday still anchors the streak (grace day).
 */
function computeStreak(reviewedAt: string[]): number {
  if (reviewedAt.length === 0) return 0;
  const days = new Set(reviewedAt.map((iso) => istDayNumber(Date.parse(iso))));
  const today = istDayNumber(Date.now());

  let cursor = days.has(today) ? today : today - 1;
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
}

export default async function LearnPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // layout already redirects unauthenticated users

  const { data: reviews } = await supabase
    .from("srs_reviews")
    .select("reviewed_at")
    .order("reviewed_at", { ascending: false });

  const streak = computeStreak((reviews ?? []).map((r) => r.reviewed_at));

  return <LearnClient streak={streak} />;
}
