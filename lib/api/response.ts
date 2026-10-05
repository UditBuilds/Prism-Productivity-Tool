import { NextResponse } from "next/server";

import type { ApiResponse } from "@/lib/api/envelope";

export type { ApiResponse };

/**
 * Send the `{ data, error }` envelope with a status — the one response shape
 * every route under app/api returns (see lib/api/envelope.ts).
 *
 * `headers` is for the routes that answer 429 with Retry-After. It is passed
 * through only when given, so a plain call builds exactly the
 * `NextResponse.json(body, { status })` every route used to inline.
 */
export function json<T>(
  body: ApiResponse<T>,
  status = 200,
  headers?: Record<string, string>
) {
  return NextResponse.json(body, headers ? { status, headers } : { status });
}
