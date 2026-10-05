import { json } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { istDateString } from "@/lib/date";
import type { MoodLog, MoodValue } from "@/types/database";

const MOOD_VALUES: MoodValue[] = [
  "great",
  "good",
  "neutral",
  "tired",
  "stressed",
];

function isMood(v: unknown): v is MoodValue {
  return typeof v === "string" && MOOD_VALUES.includes(v as MoodValue);
}

// GET /api/mood — last 30 logs, newest first
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  const { data, error } = await supabase
    .from("mood_logs")
    .select("*")
    .order("logged_date", { ascending: false })
    .limit(30);

  if (error) return json({ data: null, error: error.message }, 500);
  return json<MoodLog[]>({ data: data ?? [], error: null });
}

// POST /api/mood — upsert today's (IST) mood
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

  if (!isMood(body.mood)) {
    return json({ data: null, error: "Invalid mood" }, 400);
  }

  const { data, error } = await supabase
    .from("mood_logs")
    .upsert(
      {
        user_id: user.id,
        mood: body.mood,
        note:
          typeof body.note === "string" && body.note.trim()
            ? body.note.trim()
            : null,
        logged_date: istDateString(),
      },
      { onConflict: "user_id,logged_date" }
    )
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  return json<MoodLog>({ data, error: null }, 201);
}
