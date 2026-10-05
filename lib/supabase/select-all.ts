import type { PostgrestError } from "@supabase/supabase-js";

/**
 * The most rows PostgREST returns in ONE response on this project.
 *
 * It is a server setting (Supabase → API → max rows, default 1,000), and it
 * caps every read SILENTLY: a request for more comes back `200 OK`, `error`
 * null, `data` cut at 1,000 rows — no flag, no count, nothing a caller can
 * notice. An explicit `.limit(5000)` is capped the same way. Measured
 * 2026-10-05 against a 41,829-row table: no range, `limit=1000` and
 * `limit=5000` all answered `Content-Range: 0-999/*`.
 *
 * Keep this equal to the project setting. If the setting is ever LOWERED, a
 * capped page is indistinguishable from a short last page and the helper below
 * would stop early — the same silent truncation it exists to remove.
 */
export const POSTGREST_MAX_ROWS = 1000;

/** What one awaited page of a query resolves to. */
interface PageResponse<Row> {
  data: Row[] | null;
  error: PostgrestError | null;
}

/**
 * The slice of a supabase-js query builder this helper drives. Structural, so
 * any `.from(...).select(...)` chain (filters and `.order` included) fits.
 */
export interface PageableQuery<Row> extends PromiseLike<PageResponse<Row>> {
  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean }
  ): PageableQuery<Row>;
  range(from: number, to: number): PageableQuery<Row>;
}

/** Same discrimination as a plain supabase-js read: rows, or an error. */
export type SelectAllResult<Row> =
  | { data: Row[]; error: null }
  | { data: null; error: PostgrestError };

export interface SelectAllOptions {
  /**
   * Hard ceiling on rows returned — what `.limit(n)` was meant to be. Omit for
   * "every matching row".
   */
  maxRows?: number;
  /**
   * A UNIQUE column appended as the final sort key when more than one page is
   * needed. Defaults to `id`, which every table read through this has.
   */
  tiebreaker?: string;
}

/**
 * Read EVERY row a query matches (up to `maxRows`), across as many pages as it
 * takes, instead of the first 1,000.
 *
 * `build` must return a FRESH builder on each call — the chain exactly as it
 * would have been awaited directly, without `.limit()` or `.range()`.
 *
 * THE COMMON CASE IS UNCHANGED. The first request is the query as written,
 * limited to one page. Anything shorter than a full page is complete, so it is
 * returned as-is: one round trip, the same rows in the same order — ties
 * included — as the unpaged query produced before this helper existed.
 *
 * ONLY A FULL FIRST PAGE PAGES. Offset pages need a TOTAL order, or a row can
 * repeat or vanish at a page boundary (bulk inserts share `created_at`, so a
 * timestamp sort alone is not total). So the read restarts from row 0 with
 * `tiebreaker` appended as the last sort key. That costs the first page twice,
 * only for result sets that the old code was silently truncating anyway.
 *
 * Pages are separate requests, not one snapshot: a write landing mid-read can
 * shift a row across a boundary. Accepted — the alternative was a guaranteed
 * cut at 1,000.
 */
export async function selectAllRows<Row>(
  build: () => PageableQuery<Row>,
  options: SelectAllOptions = {}
): Promise<SelectAllResult<Row>> {
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
  const tiebreaker = options.tiebreaker ?? "id";

  const firstSize = Math.min(POSTGREST_MAX_ROWS, maxRows);
  const first = await build().range(0, firstSize - 1);
  if (first.error) return { data: null, error: first.error };
  const firstRows = first.data ?? [];
  if (firstRows.length < POSTGREST_MAX_ROWS || firstRows.length >= maxRows) {
    return { data: firstRows, error: null };
  }

  const rows: Row[] = [];
  for (let from = 0; from < maxRows; from += POSTGREST_MAX_ROWS) {
    const to = Math.min(from + POSTGREST_MAX_ROWS, maxRows) - 1;
    const page = await build()
      .order(tiebreaker, { ascending: true })
      .range(from, to);
    if (page.error) return { data: null, error: page.error };
    const pageRows = page.data ?? [];
    for (const row of pageRows) rows.push(row);
    if (pageRows.length < to - from + 1) break;
  }
  return { data: rows, error: null };
}
