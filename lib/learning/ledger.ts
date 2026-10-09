import type { SupabaseClient } from "@supabase/supabase-js";

import { LEARNING_DAILY_TOKEN_CAP } from "@/lib/learning/constants";
import type { CallRecord } from "@/lib/learning/groq";
import type { Database } from "@/types/database";

/**
 * learning_ai_calls: one row per Groq call learning makes, written by the
 * route that made it (RLS: the user's own client, insert + select only).
 *
 * The daily cap is the sum of these rows over the last 24 hours, so it holds
 * across serverless instances and cold starts — the in-memory rate limiter in
 * lib/ai/rateLimit.ts cannot. Failed and rate-limited calls are logged too:
 * Groq bills the tokens of a call whose answer we then threw away.
 */

type Client = SupabaseClient<Database>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Dev-only test hooks, so the failure paths can be run for real on a local
 * server (truncated output, the daily cap). Ignored in production builds.
 */
export function devOverride(name: string): number | null {
  if (process.env.NODE_ENV === "production") return null;
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function dailyTokenCap(): number {
  return devOverride("LEARNING_TEST_DAILY_CAP") ?? LEARNING_DAILY_TOKEN_CAP;
}

export async function logCall(
  supabase: Client,
  userId: string,
  ids: { topicId: string | null; stepId: string | null },
  rec: CallRecord
): Promise<void> {
  // Awaited: an un-awaited write is dropped when the instance freezes after
  // the response. A failure is logged, not swallowed — the ledger is what the
  // cap is computed from, so a silent gap would under-count spend.
  const { error } = await supabase.from("learning_ai_calls").insert({
    user_id: userId,
    topic_id: ids.topicId,
    step_id: ids.stepId,
    ...rec,
  });
  if (error) console.error("[learning] ledger insert failed:", error.message);
}

export interface BudgetState {
  used: number;
  cap: number;
  /** Seconds until enough of the window ages out to start again; 0 when allowed. */
  retryAfterSeconds: number;
}

export async function budgetState(supabase: Client, userId: string, nowMs = Date.now()): Promise<BudgetState> {
  const cap = dailyTokenCap();
  const since = new Date(nowMs - DAY_MS).toISOString();
  const { data, error } = await supabase
    .from("learning_ai_calls")
    .select("total_tokens, created_at")
    .eq("user_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) {
    // Fail closed: if spend cannot be read, do not spend.
    console.error("[learning] ledger read failed:", error.message);
    return { used: cap, cap, retryAfterSeconds: 60 };
  }
  const rows = data ?? [];
  const used = rows.reduce((n, r) => n + r.total_tokens, 0);
  if (used < cap) return { used, cap, retryAfterSeconds: 0 };
  // Walk forward until the remaining window is under the cap again.
  let remaining = used;
  for (const r of rows) {
    remaining -= r.total_tokens;
    if (remaining < cap) {
      const freesAt = Date.parse(r.created_at) + DAY_MS;
      return { used, cap, retryAfterSeconds: Math.max(60, Math.ceil((freesAt - nowMs) / 1000)) };
    }
  }
  return { used, cap, retryAfterSeconds: 60 };
}
