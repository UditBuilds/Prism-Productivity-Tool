import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  CATEGORIES,
  categoryChartColor as staticCategoryChartColor,
} from "@/components/focus/categories";

const FOCUS_CATEGORIES_KEY = ["focus-categories"] as const;

/** Raw row shape returned by /api/focus/categories. */
export interface FocusCategoryRow {
  id: string;
  user_id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
}

/**
 * Live category enriched for the UI. `label`/`emoji`/`activeClass`/`chartColor`
 * mirror the old static FocusCategory shape so consumers migrate with minimal
 * change. emoji/activeClass aren't stored in the DB — they're looked up from the
 * static seed source by name, with neutral fallbacks for unknown names.
 */
export interface FocusCategoryItem {
  id: string;
  label: string;
  emoji: string;
  activeClass: string;
  chartColor: string;
  sortOrder: number;
}

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

async function apiRequest<T>(
  method: string,
  body?: unknown,
  query = ""
): Promise<T> {
  const res = await fetch(`/api/focus/categories${query}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!res.ok || json.error || json.data === null) {
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  return json.data;
}

// Module-level guard so the one-time seed never fires twice in a session, even
// across multiple mounted consumers or a later refetch.
let seedAttempted = false;

/**
 * GET the list. If it's genuinely empty and we haven't tried this session, seed
 * the static categories.ts entries (name + color), preserving their order via
 * sequential inserts, then re-fetch. React Query dedupes concurrent runs of this
 * queryFn (shared key), so simultaneous consumers can't double-seed.
 */
async function fetchOrSeed(): Promise<FocusCategoryRow[]> {
  let rows = await apiRequest<FocusCategoryRow[]>("GET");
  if (rows.length === 0 && !seedAttempted) {
    seedAttempted = true;
    for (const c of CATEGORIES) {
      await apiRequest<FocusCategoryRow>("POST", {
        name: c.label,
        color: c.chartColor,
      });
    }
    rows = await apiRequest<FocusCategoryRow[]>("GET");
  }
  return rows;
}

// Fallback styling for categories the user creates later that have no static
// metadata (no create UI yet this session, but keeps unknowns safe).
const FALLBACK_EMOJI = "🎯";
const FALLBACK_ACTIVE_CLASS =
  "border-accent bg-accent/15 text-foreground";

function enrich(rows: FocusCategoryRow[]): FocusCategoryItem[] {
  return rows.map((row) => {
    const meta = CATEGORIES.find((c) => c.label === row.name);
    return {
      id: row.id,
      label: row.name,
      emoji: meta?.emoji ?? FALLBACK_EMOJI,
      activeClass: meta?.activeClass ?? FALLBACK_ACTIVE_CLASS,
      chartColor: row.color,
      sortOrder: row.sort_order,
    };
  });
}

export const focusCategoriesQueryOptions = {
  queryKey: FOCUS_CATEGORIES_KEY,
  queryFn: fetchOrSeed,
  staleTime: 10 * 60 * 1000,
  gcTime: 30 * 60 * 1000,
};

/**
 * The user's live focus categories + a categoryChartColor() that resolves a
 * color by name from that live list, falling back to the static categories.ts
 * lookup (and its gray default) for names not in the list — covering old
 * focus_sessions whose category was since renamed or deleted.
 */
export function useFocusCategories() {
  const { data, isLoading, isError } = useQuery(focusCategoriesQueryOptions);

  const categories = useMemo(() => enrich(data ?? []), [data]);

  const categoryChartColor = useCallback(
    (name: string): string => {
      const found = categories.find((c) => c.label === name);
      return found ? found.chartColor : staticCategoryChartColor(name);
    },
    [categories]
  );

  return { categories, categoryChartColor, isLoading, isError };
}
