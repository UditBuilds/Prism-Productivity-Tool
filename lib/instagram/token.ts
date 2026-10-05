// Long-lived token handling for Meta / Instagram.
//
// SERVER-ONLY — every function here handles credentials.
//
// ── The thing that is easy to get wrong ──────────────────────────────────────
//
// "Meta tokens last ~60 days and there is a documented refresh call" is TRUE
// for one kind of token and FALSE for the kind this module actually uses.
// There are two separate publishing paths, with two different token lifecycles,
// and the refresh endpoint of one does not work on the other:
//
//   A. Instagram Login  → an INSTAGRAM USER access token.
//      Refreshed by  GET /refresh_access_token?grant_type=ig_refresh_token
//      60 days, and the token must be at least 24 hours old to be refreshable.
//
//   B. Facebook Login   → a PAGE access token.  ← what META_PAGE_ACCESS_TOKEN is
//      There is NO refresh endpoint on this path. A long-lived USER token lasts
//      ~60 days and is extended by re-exchanging it through
//      GET /oauth/access_token?grant_type=fb_exchange_token. A long-lived PAGE
//      token derived from a long-lived user token, per Meta's own docs, "do not
//      have an expiration date and only expire or are invalidated under certain
//      conditions" — a password change, a revoked permission, a rotated app
//      secret, or the user losing access to the Page.
//
// So on path B the honest job is NOT "refresh every 59 days on a timer". It is
// INSPECT the token, and re-derive it only when inspection says it is dying.
// A blind periodic refresh on this path would be a call that either no-ops or
// fails, dressed up as maintenance — and would hide the real failure mode,
// which is sudden invalidation, not gradual expiry.
//
// Both paths are implemented, because which one an account ends up on is
// decided during Meta app setup, not here. inspectToken() is what tells you
// which one you actually have: a Page token reports a `profile_id`.

import {
  GRAPH_BASE_URL,
  appAccessToken,
  requireInstagramConfig,
  type InstagramConfig,
} from "./config";
import { InstagramError, instagramErrorFromGraph } from "./errors";
import type { InstagramTokenHealth } from "./types";

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Below this many days remaining, a token should be renewed.
 *
 * 7 days, sized against the failure it prevents rather than picked for
 * roundness: renewal here is a MANUAL operation (someone re-derives a token and
 * updates an env var, then redeploys), so the window has to be wide enough to
 * survive a weekend and a busy week. It is meaningless for a non-expiring Page
 * token, where daysRemaining is null and nothing is ever "near expiry".
 */
export const TOKEN_RENEWAL_THRESHOLD_DAYS = 7;

interface TokenRequestOptions {
  path: string;
  query: Record<string, string>;
  /** Sent as a Bearer header, never as a query param. */
  bearer: string;
}

/**
 * A Graph call for the token endpoints.
 *
 * Kept separate from the client's graphRequest for one reason: these endpoints
 * take an *inspected* token as DATA (`input_token`, `fb_exchange_token`) while
 * authenticating with a DIFFERENT token. Conflating the two is how a token gets
 * accidentally sent as the wrong parameter, so the distinction is structural
 * here rather than a convention to remember.
 */
async function tokenRequest<T>(
  config: InstagramConfig,
  options: TokenRequestOptions
): Promise<T> {
  const url = new URL(
    `${GRAPH_BASE_URL}/${config.graphVersion}/${options.path}`
  );
  for (const [key, value] of Object.entries(options.query)) {
    url.searchParams.set(key, value);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${options.bearer}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    throw new InstagramError(
      "NETWORK_ERROR",
      timedOut
        ? "Meta's token endpoint did not respond in time"
        : "Could not reach Meta's token endpoint"
    );
  }

  const raw = await res.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new InstagramError(
        "GRAPH_ERROR",
        `Meta's token endpoint returned an unreadable response (HTTP ${res.status})`
      );
    }
  }
  if (!res.ok) throw instagramErrorFromGraph(res.status, payload);
  return payload as T;
}

const MS_PER_DAY = 86_400_000;

/**
 * Inspect a token: is it valid, when does it die, what can it do.
 *
 * Authenticated with the APP access token (`{app-id}|{app-secret}`), which is
 * what GET /debug_token requires — you cannot inspect a token using itself.
 *
 * ⚠️ `expires_at: 0` means NEVER EXPIRES, not "expired in 1970". Read naively
 * through `new Date(0)` it looks like the most expired token imaginable, and
 * any "renew if expiring soon" check would then fire forever on exactly the
 * token that needs no renewal. It is normalised to null here so that mistake
 * cannot be made downstream.
 */
export async function inspectToken(
  token: string,
  config: InstagramConfig = requireInstagramConfig()
): Promise<InstagramTokenHealth> {
  const payload = await tokenRequest<{ data?: unknown }>(config, {
    path: "debug_token",
    query: { input_token: token },
    bearer: appAccessToken(config),
  });

  const data =
    typeof payload?.data === "object" && payload.data !== null
      ? (payload.data as Record<string, unknown>)
      : {};

  const rawExpires =
    typeof data.expires_at === "number" ? data.expires_at : null;
  const expiresAt =
    rawExpires && rawExpires > 0 ? new Date(rawExpires * 1000) : null;

  const rawDataAccess =
    typeof data.data_access_expires_at === "number"
      ? data.data_access_expires_at
      : null;

  return {
    isValid: data.is_valid === true,
    expiresAt,
    daysRemaining: expiresAt
      ? Math.floor((expiresAt.getTime() - Date.now()) / MS_PER_DAY)
      : null,
    dataAccessExpiresAt:
      rawDataAccess && rawDataAccess > 0
        ? new Date(rawDataAccess * 1000)
        : null,
    scopes: Array.isArray(data.scopes)
      ? data.scopes.filter((s): s is string => typeof s === "string")
      : [],
    profileId: typeof data.profile_id === "string" ? data.profile_id : null,
    appId: typeof data.app_id === "string" ? data.app_id : null,
  };
}

/**
 * True when a token needs renewing.
 *
 * An INVALID token needs attention regardless of dates. A non-expiring token
 * (daysRemaining null) never does — see the expires_at trap above.
 */
export function needsRenewal(
  health: InstagramTokenHealth,
  thresholdDays: number = TOKEN_RENEWAL_THRESHOLD_DAYS
): boolean {
  if (!health.isValid) return true;
  if (health.daysRemaining === null) return false;
  return health.daysRemaining <= thresholdDays;
}

/** One line a human can act on, for a health check or a log. */
export function describeTokenHealth(health: InstagramTokenHealth): string {
  if (!health.isValid) {
    return "Token is not valid — it was revoked, expired, or belongs to another app.";
  }
  if (health.daysRemaining === null) {
    return health.profileId
      ? "Token is valid and does not expire (long-lived Page token)."
      : "Token is valid and does not expire.";
  }
  if (health.daysRemaining <= 0) return "Token expires today.";
  return `Token is valid for ${health.daysRemaining} more day${
    health.daysRemaining === 1 ? "" : "s"
  }.`;
}

interface LongLivedToken {
  accessToken: string;
  /** null when Meta returns no expires_in — i.e. it does not expire. */
  expiresAt: Date | null;
}

function readTokenPayload(payload: unknown): LongLivedToken {
  const row =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  const accessToken =
    typeof row.access_token === "string" ? row.access_token : "";
  if (!accessToken) {
    throw new InstagramError(
      "GRAPH_ERROR",
      "Meta returned no access token in the exchange response"
    );
  }
  const expiresIn =
    typeof row.expires_in === "number" ? row.expires_in : null;
  return {
    accessToken,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
  };
}

/**
 * PATH B, step 1 — exchange a short-lived user token for a long-lived one
 * (~60 days).
 *
 * Also the way an existing long-lived user token is EXTENDED: the same call
 * with a still-valid long-lived token returns a fresh one. There is no separate
 * refresh endpoint on the Facebook-login path; this is it.
 *
 * The token being exchanged is passed as `fb_exchange_token` — a data
 * parameter — while the call authenticates with the app token.
 */
export async function exchangeForLongLivedUserToken(
  userAccessToken: string,
  config: InstagramConfig = requireInstagramConfig()
): Promise<LongLivedToken> {
  const payload = await tokenRequest<unknown>(config, {
    path: "oauth/access_token",
    query: {
      grant_type: "fb_exchange_token",
      client_id: config.appId,
      client_secret: config.appSecret,
      fb_exchange_token: userAccessToken,
    },
    bearer: appAccessToken(config),
  });
  return readTokenPayload(payload);
}

/**
 * PATH B, step 2 — derive the Page access token.
 *
 * Must be called with a LONG-LIVED user token: a Page token inherits its
 * lifetime from the user token it came from, so deriving one from a
 * short-lived token silently produces a Page token that dies in about an hour.
 * That is the single most common way this setup goes wrong, and it looks
 * identical to success until it stops working.
 *
 * `pageId` picks a specific Page when the user administers several; without it
 * the first Page is returned, which is only safe on a single-Page account.
 */
export async function fetchLongLivedPageToken(
  longLivedUserToken: string,
  pageId: string | null = null,
  config: InstagramConfig = requireInstagramConfig()
): Promise<{ pageId: string; pageName: string; accessToken: string }> {
  const payload = await tokenRequest<{ data?: unknown }>(config, {
    path: "me/accounts",
    query: { fields: "id,name,access_token" },
    bearer: longLivedUserToken,
  });

  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const pages = rows
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => ({
      pageId: typeof r.id === "string" ? r.id : "",
      pageName: typeof r.name === "string" ? r.name : "",
      accessToken: typeof r.access_token === "string" ? r.access_token : "",
    }))
    .filter((p) => p.pageId && p.accessToken);

  if (pages.length === 0) {
    throw new InstagramError(
      "PERMISSION_DENIED",
      "This user administers no Pages, or the token lacks the pages_show_list permission"
    );
  }

  if (!pageId) return pages[0];

  const match = pages.find((p) => p.pageId === pageId);
  if (!match) {
    throw new InstagramError(
      "PERMISSION_DENIED",
      `Page ${pageId} was not among the Pages this user administers`
    );
  }
  return match;
}

/**
 * PATH A — refresh an Instagram User access token.
 *
 * Only valid on the Instagram-login path. Calling it with a Facebook PAGE
 * token does not work, which is exactly why this function is named for its
 * path instead of being called `refreshToken()` and reached for by default.
 *
 * Meta requires the token to be at least 24 hours old and not yet expired; the
 * refreshed token is good for another 60 days.
 */
export async function refreshInstagramUserToken(
  instagramUserToken: string,
  config: InstagramConfig = requireInstagramConfig()
): Promise<LongLivedToken> {
  const payload = await tokenRequest<unknown>(config, {
    path: "refresh_access_token",
    query: { grant_type: "ig_refresh_token" },
    bearer: instagramUserToken,
  });
  return readTokenPayload(payload);
}

/**
 * Check the configured Page token and say plainly what state it is in.
 *
 * This is the function a scheduled health check should call. It deliberately
 * does NOT rotate anything: renewal on the Facebook-login path ends with a new
 * value in META_PAGE_ACCESS_TOKEN and a redeploy, which is a human action.
 * Silently minting a token this process cannot persist would report success and
 * change nothing.
 */
export async function checkConfiguredToken(
  config: InstagramConfig = requireInstagramConfig()
): Promise<{ health: InstagramTokenHealth; needsAction: boolean; summary: string }> {
  const health = await inspectToken(config.pageAccessToken, config);
  const needsAction = needsRenewal(health);
  return { health, needsAction, summary: describeTokenHealth(health) };
}
