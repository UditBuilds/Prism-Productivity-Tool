/**
 * Push-endpoint validation for POST /api/push/subscribe.
 *
 * WHY THIS EXISTS
 * ---------------
 * `push_subscriptions.endpoint` is attacker-controlled: any logged-in user can
 * POST an arbitrary string, and /api/push/due later feeds that string straight
 * into `webpush.sendNotification()`. That turns a stored row into a
 * server-side request forgery primitive — the next cron tick makes an outbound
 * HTTPS request, from Vercel's network, to whatever host the row names.
 *
 * Validation happens HERE, at write time, not at send time. Rejecting before
 * the row is ever stored means there is no window in which a malicious
 * endpoint sits in the table waiting for a reminder to fire, and no dependency
 * on every future sender remembering to re-check.
 *
 * TWO INDEPENDENT CONTROLS
 * ------------------------
 * 1. A host allowlist (the strong control). Web Push endpoints are minted by
 *    the browser's push service, not by the page, so the set of legitimate
 *    hosts is small, known, and closed. Nothing outside it is ever valid.
 * 2. A DNS resolution check (defence in depth). A hostname can pass a
 *    string-level check and still resolve to an internal address, so every
 *    address the host resolves to is checked against the private/reserved
 *    ranges.
 *
 * The allowlist is what actually stops SSRF. The DNS check only adds value if
 * an allowlisted host is ever poisoned or rebound, and it is explicitly NOT a
 * complete defence against DNS rebinding: it observes resolution at write
 * time, and nothing stops the record changing before the cron sends. Bounding
 * the eventual request is the send-side timeout's job (see /api/push/due).
 */

import { lookup } from "node:dns/promises";

/**
 * Hosts that browser push services actually mint endpoints on.
 *
 * Derived from two sources, not from memory:
 * - This app's live `push_subscriptions` rows, which use exactly two hosts:
 *   `fcm.googleapis.com` (Chrome on Windows) and `web.push.apple.com`
 *   (the installed iOS PWA). Those are the only two that must not break.
 * - The remaining major implementations of the Web Push spec, added so a
 *   Firefox or WNS-backed browser isn't rejected the first time one is used.
 */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  // Chrome, Edge (Chromium), Opera, Brave, Samsung Internet.
  "fcm.googleapis.com",
  // Legacy GCM host, still emitted by some older Chromium builds.
  "android.googleapis.com",
  // Safari — macOS 13+ and iOS 16.4+ installed PWAs. This app's iOS path.
  "web.push.apple.com",
  // Firefox autopush.
  "updates.push.services.mozilla.com",
]);

/**
 * Windows Notification Service endpoints are per-datacentre subdomains
 * (`wns2-by3p.notify.windows.com`, `db5p.notify.windows.com`, …), so they
 * can't be enumerated. Matched by suffix — with the leading dot, so
 * `evilnotify.windows.com` does not match and a bare `notify.windows.com`
 * (never a real endpoint host) does not either.
 */
const ALLOWED_HOST_SUFFIXES: readonly string[] = [".notify.windows.com"];

/**
 * Real endpoints run 100–300 characters. The cap is generous enough to never
 * reject a genuine one while keeping a multi-megabyte string out of the
 * column and out of the log-line builder in /api/push/due.
 */
const MAX_ENDPOINT_LENGTH = 2048;

export type EndpointValidation =
  | { ok: true; endpoint: string }
  | { ok: false; error: string };

function hostIsAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (ALLOWED_HOSTS.has(host)) return true;
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * True for addresses that must never be the target of a server-initiated
 * request: loopback, private, link-local (which covers the 169.254.169.254
 * cloud metadata endpoint), CGNAT, multicast, and the reserved/documentation
 * blocks.
 */
function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) return true; // unparseable → refuse
  const octets = parts.map((p) => Number(p));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return true;
  const [a, b] = octets;

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24 TEST-NET-1
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a === 198 && b === 51) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0) return true; // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true; // 224/4 multicast + 240/4 reserved + broadcast

  return false;
}

function isBlockedIpv6(address: string): boolean {
  const addr = address.toLowerCase().split("%")[0]; // strip any zone index

  // IPv4-mapped (::ffff:127.0.0.1) and NAT64 (64:ff9b::7f00:1) carry a v4
  // address inside a v6 literal — unwrap and judge it as v4, or an internal
  // target could be smuggled past the v6 prefix checks below.
  const embedded = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (embedded) return isBlockedIpv4(embedded[1]);

  if (addr === "::" || addr === "::1") return true; // unspecified / loopback
  if (addr.startsWith("::ffff:")) return true; // mapped, non-dotted form
  if (addr.startsWith("64:ff9b:")) return true; // NAT64, non-dotted form
  if (addr.startsWith("2002:")) return true; // 6to4 — wraps an arbitrary v4
  if (/^f[cd][0-9a-f]{2}:/.test(addr)) return true; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(addr)) return true; // fe80::/10 link-local
  if (/^ff[0-9a-f]{2}:/.test(addr)) return true; // ff00::/8 multicast

  return false;
}

function isBlockedAddress(address: string, family: number): boolean {
  return family === 6 ? isBlockedIpv6(address) : isBlockedIpv4(address);
}

/**
 * Validate a submitted push endpoint. Returns the normalised URL string to
 * store, or a message safe to hand back to the client.
 *
 * The error text names the actual reason. These endpoints are minted by the
 * browser, so a user can neither cause nor fix a rejection by editing
 * anything — a vague message would just make a genuine browser-compatibility
 * failure undebuggable, and the reasons leak nothing the allowlist doesn't
 * already state.
 */
export async function validatePushEndpoint(
  raw: string
): Promise<EndpointValidation> {
  if (raw.length > MAX_ENDPOINT_LENGTH) {
    return { ok: false, error: "Push endpoint is too long" };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Push endpoint must be a valid URL" };
  }

  if (url.protocol !== "https:") {
    return { ok: false, error: "Push endpoint must use HTTPS" };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Push endpoint must not contain credentials" };
  }
  // Every real push service listens on 443. An explicit alternate port only
  // ever appears when someone is aiming the sender somewhere it shouldn't go.
  if (url.port && url.port !== "443") {
    return { ok: false, error: "Push endpoint must use the default HTTPS port" };
  }
  if (!hostIsAllowed(url.hostname)) {
    return {
      ok: false,
      error: "Push endpoint is not a recognised browser push service",
    };
  }

  // Defence in depth: an allowlisted name must still resolve to public space.
  // `all: true` so a host that returns several records can't hide an internal
  // one behind a public first answer.
  try {
    const addresses = await lookup(url.hostname, { all: true });
    if (addresses.length === 0) {
      return { ok: false, error: "Push endpoint host could not be resolved" };
    }
    if (addresses.some((a) => isBlockedAddress(a.address, a.family))) {
      return {
        ok: false,
        error: "Push endpoint resolves to a non-public address",
      };
    }
  } catch {
    return { ok: false, error: "Push endpoint host could not be resolved" };
  }

  return { ok: true, endpoint: url.toString() };
}

/** Exported for the unit test only. */
export const __testing = { isBlockedIpv4, isBlockedIpv6, hostIsAllowed };
