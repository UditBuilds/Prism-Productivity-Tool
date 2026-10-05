import type { ApiResponse } from "@/lib/api/envelope";

/**
 * Call an app route and unwrap its `{ data, error }` envelope: resolve with
 * `data`, or throw an Error carrying the route's own message.
 *
 * This was copied, byte for byte, into every hook file — so it is kept
 * byte-for-byte compatible, because every offline-resumable mutationFn runs
 * through it (lib/offline-mutations.ts) and TanStack's retry/pause logic only
 * sees what this throws:
 *
 * - No `method` → `fetch(url)` with NO init, exactly what the GET-only hooks
 *   did. With a method, the JSON header and body are sent only when `body` is
 *   truthy, as before.
 * - It throws on ANY non-OK status, on a non-null `error`, and on a null
 *   `data` — the same three-way gate, with the same message:
 *   `json.error`, else `Request failed (<status>)`.
 * - A body that is not JSON still throws whatever `res.json()` throws. A
 *   friendlier message there is worth having, but it would change what users
 *   see on a platform 5xx page, so it is a deliberate follow-up, not a
 *   side effect of de-duplicating.
 */
export async function apiFetch<T>(
  url: string,
  method?: string,
  body?: unknown
): Promise<T> {
  const res =
    method === undefined
      ? await fetch(url)
      : await fetch(url, {
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
