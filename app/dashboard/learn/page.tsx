import { createClient } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/select-all";
import { computeLearningStreak } from "@/lib/srs/streak";
import { LearnClient } from "@/components/srs/LearnClient";

export default async function LearnPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // layout already redirects unauthenticated users

  // Paged: an unpaged read silently stops at 1,000 rows, which would cap the
  // streak at however many days the newest 1,000 reviews happen to span.
  const { data: reviews } = await selectAllRows(() =>
    supabase
      .from("srs_reviews")
      .select("reviewed_at")
      .order("reviewed_at", { ascending: false })
  );

  // The same rule GET /api/srs/analytics uses, so this server-rendered figure
  // and the client's analytics figure agree.
  const { streak } = computeLearningStreak(
    (reviews ?? []).map((r) => r.reviewed_at),
    Date.now()
  );

  return <LearnClient streak={streak} />;
}
