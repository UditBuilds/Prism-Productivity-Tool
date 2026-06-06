import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { PushSubscriptionRow } from "@/types/database";

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

// POST /api/push/subscribe — upsert this device's push subscription
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ data: null, error: "Invalid JSON body" }, 400);
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body.p256dh === "string" ? body.p256dh : "";
  const auth = typeof body.auth === "string" ? body.auth : "";
  if (!endpoint || !p256dh || !auth) {
    return json(
      { data: null, error: "endpoint, p256dh, and auth are required" },
      400
    );
  }

  const userAgent =
    typeof body.userAgent === "string" ? body.userAgent : null;

  // Upsert on (user_id, endpoint) so re-subscribing the same device updates
  // its keys rather than creating duplicates.
  const { data, error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent,
      },
      { onConflict: "user_id,endpoint" }
    )
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  return json<PushSubscriptionRow>({ data, error: null }, 201);
}
