import dns from "node:dns";
import https from "node:https";
import type { LookupFunction } from "node:net";

import { checkFetchUrl, isBlockedAddress } from "@/lib/learning/net-guard";

/**
 * Fetch one web page for a lesson, safely. SERVER-ONLY.
 *
 * Every URL this fetches is untrusted: a search result can point anywhere, and
 * the follow-up "add your own source" PR will pass links Udit pastes. So:
 *
 *   - https only, standard port, no credentials in the URL (net-guard.ts)
 *   - the address is checked AT CONNECT TIME, inside the socket's DNS lookup,
 *     so a name that re-resolves to 127.0.0.1 between check and connect
 *     cannot slip through
 *   - redirects are followed by hand, at most MAX_REDIRECTS, and every hop
 *     goes through the same two checks
 *   - one deadline for the WHOLE fetch: node's own `timeout` only fires on an
 *     idle socket, so a server dripping one byte every few seconds would
 *     otherwise hold the request for the full 60s function budget
 *   - a hard size cap, counted as bytes arrive
 *   - no cookies and no auth headers: nothing is sent that identifies Prism's
 *     user, and nothing a page sets is kept
 */

export const MAX_REDIRECTS = 3;
export const MAX_PAGE_BYTES = 2_000_000;
export const FETCH_DEADLINE_MS = 8_000;

const ALLOWED_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];

export type SafeFetchErrorCode =
  | "blocked"
  | "timeout"
  | "too_large"
  | "redirects"
  | "http_status"
  | "content_type"
  | "network";

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface FetchedPage {
  /** Where the page actually came from, after redirects. */
  url: string;
  status: number;
  contentType: string;
  body: string;
  fetchedAt: string;
}

/** DNS lookup that refuses to hand the socket a blocked address. */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err, "", 4);
      return;
    }
    const list = Array.isArray(addresses) ? addresses : [];
    const bad = list.find((a) => isBlockedAddress(a.address));
    if (list.length === 0 || bad) {
      const blocked = Object.assign(
        new Error(`blocked address${bad ? ` ${bad.address}` : ""} for ${hostname}`),
        { code: "EBLOCKED" }
      );
      callback(blocked, "", 4);
      return;
    }
    if (options.all) {
      // Node's happy-eyeballs path asks for every address at once.
      (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
      return;
    }
    callback(null, list[0].address, list[0].family);
  });
};

function decode(buf: Buffer, contentType: string): string {
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().toLowerCase();
  try {
    return new TextDecoder(charset || "utf-8").decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

function requestOnce(
  url: URL,
  deadlineAt: number
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer | null }> {
  return new Promise((resolve, reject) => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      reject(new SafeFetchError("timeout", "the page took too long to answer"));
      return;
    }
    const req = https.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup,
        headers: {
          "User-Agent": "PrismLearning/1.0 (lesson sources; +https://prism-productivity-tool.vercel.app)",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
          "Accept-Language": "en",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, headers: res.headers, body: null });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_PAGE_BYTES) {
            req.destroy(new SafeFetchError("too_large", "the page is too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      }
    );
    const timer = setTimeout(
      () => req.destroy(new SafeFetchError("timeout", "the page took too long to answer")),
      remaining
    );
    req.on("close", () => clearTimeout(timer));
    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err instanceof SafeFetchError) reject(err);
      else if (err.code === "EBLOCKED") reject(new SafeFetchError("blocked", "private and local addresses are not allowed"));
      else reject(new SafeFetchError("network", "the site could not be reached"));
    });
    req.end();
  });
}

/**
 * GET one page. Resolves only with a 2xx HTML or plain-text page; everything
 * else throws SafeFetchError with a code the caller can report honestly.
 */
export async function safeFetchPage(
  rawUrl: string,
  deadlineMs = FETCH_DEADLINE_MS
): Promise<FetchedPage> {
  const deadlineAt = Date.now() + deadlineMs;
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const verdict = checkFetchUrl(current);
    if (!verdict.ok) throw new SafeFetchError("blocked", verdict.reason);

    const res = await requestOnce(verdict.url, deadlineAt);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.location;
      const next = Array.isArray(location) ? location[0] : location;
      if (!next) throw new SafeFetchError("http_status", "the site sent a redirect with no address", res.status);
      current = new URL(next, verdict.url).toString();
      continue;
    }
    if (res.status < 200 || res.status > 299 || !res.body) {
      throw new SafeFetchError("http_status", `the site answered ${res.status}`, res.status);
    }
    const contentType = String(res.headers["content-type"] ?? "").toLowerCase();
    if (!ALLOWED_TYPES.some((t) => contentType.startsWith(t))) {
      throw new SafeFetchError("content_type", "the link is not a web page", res.status);
    }
    return {
      url: verdict.url.toString(),
      status: res.status,
      contentType,
      body: decode(res.body, contentType),
      fetchedAt: new Date().toISOString(),
    };
  }
  throw new SafeFetchError("redirects", "the link redirects too many times");
}
