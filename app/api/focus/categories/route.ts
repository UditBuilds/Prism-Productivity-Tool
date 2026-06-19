import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

type ApiResponse<T> = { data: T | null; error: string | null };

function json<T>(body: ApiResponse<T>, status = 200) {
  return NextResponse.json(body, { status });
}

// `focus_categories` exists in the database but is not yet part of the shared
// `Database` type (types/database.ts is out of scope this session). Describe the
// slice this route needs locally so the client stays fully typed — no `any`.
// NOTE: a `type` (not `interface`) — supabase-js's GenericTable requires
// `Row extends Record<string, unknown>`, which interfaces don't satisfy (no
// implicit index signature), making the table resolve to `never`.
type FocusCategoryRow = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
};

// Self-contained schema with just the table this route touches. Intersecting
// the full Database tables type leaves a purely-added table resolving to `never`
// for inserts/projections; a minimal standalone schema resolves cleanly, and
// this route never queries any other table.
type FocusSchema = {
  public: {
    Tables: {
      focus_categories: {
        Row: FocusCategoryRow;
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          color: string;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          color?: string;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

// Service client recast to the schema that includes focus_categories.
function db(): SupabaseClient<FocusSchema> {
  return createClient() as unknown as SupabaseClient<FocusSchema>;
}

// #abc or #aabbcc
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// GET /api/focus/categories — the user's categories, ordered by sort_order asc.
export async function GET() {
  const supabase = db();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  const { data, error } = await supabase
    .from("focus_categories")
    .select("*")
    .eq("user_id", user.id)
    .order("sort_order", { ascending: true });

  if (error) return json({ data: null, error: error.message }, 500);
  return json<FocusCategoryRow[]>({ data: data ?? [], error: null });
}

// POST /api/focus/categories — create one; sort_order = current max + 1.
export async function POST(request: Request) {
  const supabase = db();
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

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const color = typeof body.color === "string" ? body.color.trim() : "";
  if (!name) return json({ data: null, error: "Name is required" }, 400);
  if (!HEX.test(color)) {
    return json({ data: null, error: "Color must be a valid hex string" }, 400);
  }

  // Next sort_order = (current max for this user) + 1.
  const { data: last, error: maxError } = await supabase
    .from("focus_categories")
    .select("sort_order")
    .eq("user_id", user.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxError) return json({ data: null, error: maxError.message }, 500);
  const nextOrder = (last?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("focus_categories")
    .insert({ user_id: user.id, name, color, sort_order: nextOrder })
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  return json<FocusCategoryRow>({ data, error: null }, 201);
}

// PATCH /api/focus/categories — update name and/or color (scoped to the user).
export async function PATCH(request: Request) {
  const supabase = db();
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

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return json({ data: null, error: "id is required" }, 400);

  const updates: { name?: string; color?: string } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return json({ data: null, error: "Name cannot be empty" }, 400);
    updates.name = name;
  }
  if (body.color !== undefined) {
    const color = typeof body.color === "string" ? body.color.trim() : "";
    if (!HEX.test(color)) {
      return json(
        { data: null, error: "Color must be a valid hex string" },
        400
      );
    }
    updates.color = color;
  }
  if (Object.keys(updates).length === 0) {
    return json({ data: null, error: "No fields to update" }, 400);
  }

  const { data, error } = await supabase
    .from("focus_categories")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return json({ data: null, error: error.message }, 500);
  if (!data) return json({ data: null, error: "Category not found" }, 404);
  return json<FocusCategoryRow>({ data, error: null });
}

// DELETE /api/focus/categories?id=… — delete one (scoped to the user). Existing
// focus_sessions rows keep their free-text category field, unaffected.
export async function DELETE(request: Request) {
  const supabase = db();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ data: null, error: "Unauthorized" }, 401);

  const { searchParams } = new URL(request.url);
  const id = (searchParams.get("id") ?? "").trim();
  if (!id) return json({ data: null, error: "id is required" }, 400);

  const { error } = await supabase
    .from("focus_categories")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return json({ data: null, error: error.message }, 500);
  return json<{ id: string }>({ data: { id }, error: null });
}
