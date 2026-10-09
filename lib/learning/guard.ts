import type { User } from "@supabase/supabase-js";

import { json } from "@/lib/api/response";
import { DEMO_REFUSAL } from "@/lib/learning/constants";
import { DEMO_EMAIL } from "@/lib/demo";
import { createClient } from "@/lib/supabase/server";

/**
 * The public demo account (supabase/demo-seed.sql `demo_id`). Kept here
 * rather than in lib/demo.ts, which an open PR is also editing;
 * scripts/test-learning.mjs asserts the two stay equal.
 */
export const LEARNING_DEMO_USER_ID = "eac085cc-54df-4414-9c43-08a6ce84ecea";

/**
 * Learning spends Groq tokens on every lesson, from the same daily budget the
 * real users' notes, flashcards and workouts use. The demo account is open to
 * anyone with the portfolio link, so it may not reach a learning route at all.
 *
 * Checked by id AND by email: email confirmation is off on this project, so a
 * visitor who changed the demo's email could slip past an email-only check.
 */
export function isDemoUser(user: Pick<User, "id" | "email">): boolean {
  return user.id === LEARNING_DEMO_USER_ID || (user.email ?? "").toLowerCase() === DEMO_EMAIL;
}

type Learner = { supabase: ReturnType<typeof createClient>; user: User };

/** Auth first (401), then the demo refusal (403). Every learning route starts here. */
export async function requireLearner(): Promise<Learner | Response> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);
  if (isDemoUser(user)) return json({ data: null, error: DEMO_REFUSAL }, 403);
  return { supabase, user };
}

/** The JSON body as a plain object, or null when it is not one. */
export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function uuidParam(v: unknown): string | null {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    ? v
    : null;
}
