/**
 * The `{ data, error }` envelope every route handler returns and every client
 * helper unwraps. Exactly one of the two is meaningful: `error` non-null means
 * the request failed and `data` is null.
 *
 * Kept free of imports so both sides can share it — the server half lives in
 * lib/api/response.ts, the client half in lib/api/client.ts.
 */
export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}
