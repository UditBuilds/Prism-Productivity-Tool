/**
 * Which addresses and URLs the learning fetcher may reach. Pure — no network —
 * so scripts/test-learning.mjs can pin every rule.
 *
 * The fetcher (safe-fetch.ts) applies isBlockedAddress to the address it is
 * ABOUT TO CONNECT TO, inside the socket's DNS lookup. Checking the hostname
 * first and connecting later would let a name that resolves to a public
 * address on the first lookup and to 127.0.0.1 on the second walk straight
 * past the check (DNS rebinding).
 */

/** Matches node:net's isIPv4 without importing it, so this file stays pure. */
function isIPv4(ip: string): boolean {
  const parts = ip.split(".");
  return (
    parts.length === 4 &&
    parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
  );
}

function blockedV4(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  return (
    a === 0 || // "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast, reserved, broadcast
  );
}

/**
 * True for any address a server-side fetch must never reach: loopback,
 * private, link-local, carrier-grade NAT, multicast, unspecified, and the IPv6
 * equivalents — including IPv4 addresses smuggled inside IPv6 (::ffff:10.0.0.1).
 * Anything that does not parse as an address is blocked too.
 */
export function isBlockedAddress(address: string): boolean {
  const ip = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (isIPv4(ip)) return blockedV4(ip);
  if (!ip.includes(":")) return true;

  // IPv4-mapped / -compatible forms: ::ffff:a.b.c.d and ::a.b.c.d
  const mapped = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return blockedV4(mapped[1]);
  // ::ffff:7f00:1 — the same mapping written in hex
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return blockedV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }

  if (ip === "::" || ip === "::1") return true;
  const first = ip.split(":")[0];
  if (first === "") return true; // any other "::…" shorthand at the start
  const head = parseInt(first, 16);
  if (Number.isNaN(head)) return true;
  return (
    (head & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (head & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (head & 0xffc0) === 0xfec0 || // fec0::/10 old site-local
    (head & 0xff00) === 0xff00 || // ff00::/8 multicast
    head === 0x2002 || // 6to4 can tunnel to any IPv4, including private ones
    head === 0x0064 // 64:ff9b::/96 NAT64 can likewise reach private IPv4
  );
}

export type UrlVerdict =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

/**
 * The checks that need no DNS: https only, no credentials in the URL, the
 * default port, a real-looking host, and no literal private address. A
 * hostname that passes here is still checked again at connect time.
 */
export function checkFetchUrl(raw: string): UrlVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid link" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "only https links are allowed" };
  if (url.username || url.password) return { ok: false, reason: "links with a login in them are not allowed" };
  if (url.port && url.port !== "443") return { ok: false, reason: "only the standard https port is allowed" };
  if (raw.length > 2048) return { ok: false, reason: "the link is too long" };

  // "localhost." (a trailing dot) is the same name as "localhost".
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (isIPv4(host) || host.includes(":")) {
    return isBlockedAddress(host)
      ? { ok: false, reason: "private and local addresses are not allowed" }
      : { ok: true, url };
  }
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".")
  ) {
    return { ok: false, reason: "private and local addresses are not allowed" };
  }
  return { ok: true, url };
}
