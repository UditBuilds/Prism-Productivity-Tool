// Instagram Graph API client — the two-step Content Publishing flow.
//
// SERVER-ONLY. Holds a Page access token in memory and must never be imported
// into a client component.
//
// This module is deliberately STANDALONE: nothing here reads Prism's database,
// touches a React Query cache, or knows what a task or a note is. It publishes
// an image that is already hosted somewhere Meta can reach, and reports what
// happened. Deciding WHAT to post is a separate problem and is not modelled here.
//
// Shape of the flow (Meta's, not ours):
//   1. POST /{ig-user-id}/media          { image_url, caption }  -> creation_id
//   2. GET  /{creation_id}?fields=status_code                    -> FINISHED
//   3. POST /{ig-user-id}/media_publish  { creation_id }         -> media id
//
// Media is FETCHED BY META from image_url; bytes are never uploaded through
// this client. That single fact drives most of the design below.

import {
  GRAPH_BASE_URL,
  requireInstagramConfig,
  type InstagramConfig,
} from "./config";
import {
  InstagramError,
  instagramErrorFromGraph,
  redactSecrets,
} from "./errors";
import {
  IG_CAPTION_MAX_CHARS,
  type IgContainerStatus,
  type InstagramPublishResult,
  type InstagramPublishingLimit,
} from "./types";

/** Per-request network timeout. Meta fetching a large image can be slow. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * How long to wait for a container to become FINISHED.
 *
 * Single-image containers are normally ready on the first check — Meta's own
 * guidance reserves status polling mainly for video and Reels, where encoding
 * takes real time. The budget exists for the case where an image is NOT
 * instant (a slow origin, a large JPEG), so that the failure mode is "we
 * waited and said so" rather than a publish attempt against a container that
 * was never ready.
 */
const CONTAINER_POLL_BUDGET_MS = 60_000;
const CONTAINER_POLL_DELAYS_MS = [1_000, 2_000, 3_000, 5_000, 8_000, 10_000];

interface GraphRequestOptions {
  method: "GET" | "POST" | "DELETE";
  path: string;
  /** Query params. NEVER put the access token here — see the note below. */
  query?: Record<string, string>;
  /** Form body for POST. */
  form?: Record<string, string>;
  /** Bearer token for this call. */
  token: string;
}

/**
 * One low-level Graph call.
 *
 * The token travels in an `Authorization: Bearer` header, NOT as an
 * `access_token` query parameter, even though Meta accepts both and every
 * example in their docs uses the query string. A credential in a URL is a
 * credential in access logs, proxy logs, and any error that echoes the request
 * line — the header keeps it out of all three. Everything else about the call
 * is identical.
 */
async function graphRequest<T>(
  config: InstagramConfig,
  options: GraphRequestOptions
): Promise<T> {
  const url = new URL(
    `${GRAPH_BASE_URL}/${config.graphVersion}/${options.path}`
  );
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.token}`,
  };
  let body: string | undefined;
  if (options.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(options.form).toString();
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method,
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    // Includes the abort on timeout. The cause is never shown raw: a fetch
    // error can carry the request URL, and a stack trace is not an answer.
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    throw new InstagramError(
      "NETWORK_ERROR",
      timedOut
        ? `Instagram's API did not respond within ${REQUEST_TIMEOUT_MS / 1000}s`
        : "Could not reach Instagram's API"
    );
  }

  const raw = await res.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      if (!res.ok) {
        throw new InstagramError(
          "GRAPH_ERROR",
          `Instagram's API returned an unreadable response (HTTP ${res.status})`
        );
      }
    }
  }

  if (!res.ok) throw instagramErrorFromGraph(res.status, payload);

  return payload as T;
}

/**
 * Reject media URLs that Meta cannot possibly fetch, before spending a
 * container creation to find out.
 *
 * The check is about REACHABILITY, not correctness of the image: Meta fetches
 * image_url from the public internet with no credentials, so an http:// link,
 * a localhost link, or an RFC1918 address is guaranteed to fail — and it fails
 * as an opaque container error many seconds later, which is a miserable thing
 * to debug. A dev-server URL is the realistic mistake this catches.
 *
 * What it does NOT check: that the URL is actually reachable or actually a
 * JPEG. Only Meta's fetcher can settle that, and a HEAD request from here
 * would prove nothing about what Meta's crawler sees.
 */
export function assertFetchableMediaUrl(imageUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new InstagramError(
      "INVALID_MEDIA_URL",
      "The image link is not a valid URL"
    );
  }

  if (parsed.protocol !== "https:") {
    throw new InstagramError(
      "INVALID_MEDIA_URL",
      `The image link must use https (got ${parsed.protocol.replace(":", "")})`
    );
  }

  const host = parsed.hostname.toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "[::1]" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  if (isPrivate) {
    throw new InstagramError(
      "INVALID_MEDIA_URL",
      `Meta fetches the image from the public internet, so it cannot reach ${host}`
    );
  }
}

/** Caption guard. See IG_CAPTION_MAX_CHARS for why this is local-only. */
export function assertValidCaption(caption: string): void {
  if (caption.length > IG_CAPTION_MAX_CHARS) {
    throw new InstagramError(
      "CAPTION_TOO_LONG",
      `The caption is ${caption.length} characters; Instagram allows ${IG_CAPTION_MAX_CHARS}`
    );
  }
}

/** Step 1 — create the media container. Returns the creation_id. */
export async function createMediaContainer(
  params: { imageUrl: string; caption?: string },
  config: InstagramConfig = requireInstagramConfig()
): Promise<string> {
  assertFetchableMediaUrl(params.imageUrl);
  const caption = params.caption ?? "";
  assertValidCaption(caption);

  const form: Record<string, string> = { image_url: params.imageUrl };
  // Send caption only when there is one. An empty-string caption is accepted
  // but records a deliberate blank where "no caption" is what was meant.
  if (caption) form.caption = caption;

  const data = await graphRequest<{ id?: unknown }>(config, {
    method: "POST",
    path: `${config.igUserId}/media`,
    form,
    token: config.pageAccessToken,
  });

  if (typeof data?.id !== "string" || !data.id) {
    throw new InstagramError(
      "GRAPH_ERROR",
      "Instagram accepted the upload but returned no container id"
    );
  }
  return data.id;
}

/** Step 2 — read a container's readiness. */
export async function getContainerStatus(
  creationId: string,
  config: InstagramConfig = requireInstagramConfig()
): Promise<{ status: IgContainerStatus | null; detail: string | null }> {
  const data = await graphRequest<{
    status_code?: unknown;
    status?: unknown;
  }>(config, {
    method: "GET",
    path: creationId,
    // `status` carries Meta's verbose explanation when status_code is ERROR.
    // It is the only field that says WHY, so it is always requested.
    query: { fields: "status_code,status" },
    token: config.pageAccessToken,
  });

  const status =
    typeof data?.status_code === "string"
      ? (data.status_code as IgContainerStatus)
      : null;
  const detail =
    typeof data?.status === "string" ? redactSecrets(data.status) : null;

  return { status, detail };
}

/**
 * Wait for a container to reach FINISHED.
 *
 * A missing status_code is treated as READY rather than as a failure. Meta does
 * not guarantee the field on every container response, and refusing to publish
 * because a diagnostic field was absent would block a post that is fine. The
 * publish call is the real gate — if the container genuinely is not ready, step
 * 3 rejects it, and that rejection is Meta's own answer rather than our guess.
 */
export async function waitForContainerReady(
  creationId: string,
  config: InstagramConfig = requireInstagramConfig(),
  budgetMs: number = CONTAINER_POLL_BUDGET_MS
): Promise<void> {
  const deadline = Date.now() + budgetMs;

  for (let attempt = 0; ; attempt++) {
    const { status, detail } = await getContainerStatus(creationId, config);

    if (status === null || status === "FINISHED" || status === "PUBLISHED") {
      return;
    }
    if (status === "ERROR") {
      throw new InstagramError(
        "CONTAINER_FAILED",
        detail
          ? `Instagram could not process the image: ${detail}`
          : "Instagram could not process the image"
      );
    }
    if (status === "EXPIRED") {
      throw new InstagramError(
        "CONTAINER_EXPIRED",
        "This upload expired before it was published"
      );
    }

    const delay =
      CONTAINER_POLL_DELAYS_MS[
        Math.min(attempt, CONTAINER_POLL_DELAYS_MS.length - 1)
      ];
    if (Date.now() + delay >= deadline) {
      throw new InstagramError(
        "CONTAINER_TIMEOUT",
        `Instagram was still processing the image after ${Math.round(
          budgetMs / 1000
        )}s`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/** Step 3 — publish the container. Returns the published media id. */
export async function publishContainer(
  creationId: string,
  config: InstagramConfig = requireInstagramConfig()
): Promise<string> {
  const data = await graphRequest<{ id?: unknown }>(config, {
    method: "POST",
    path: `${config.igUserId}/media_publish`,
    form: { creation_id: creationId },
    token: config.pageAccessToken,
  });

  if (typeof data?.id !== "string" || !data.id) {
    throw new InstagramError(
      "GRAPH_ERROR",
      "Instagram accepted the publish but returned no media id"
    );
  }
  return data.id;
}

/**
 * Read a published post back.
 *
 * This is what turns "the API returned 200" into "the post exists on the
 * account". A permalink that resolves is evidence; a 200 from media_publish on
 * its own is not, and the difference matters when reporting whether a test
 * post actually appeared.
 */
export async function getMediaPermalink(
  mediaId: string,
  config: InstagramConfig = requireInstagramConfig()
): Promise<string | null> {
  const data = await graphRequest<{ permalink?: unknown }>(config, {
    method: "GET",
    path: mediaId,
    query: { fields: "permalink" },
    token: config.pageAccessToken,
  });
  return typeof data?.permalink === "string" ? data.permalink : null;
}

/** Remaining slots against Instagram's 100-posts-per-24h ceiling. */
export async function getPublishingLimit(
  config: InstagramConfig = requireInstagramConfig()
): Promise<InstagramPublishingLimit> {
  const data = await graphRequest<{ data?: unknown }>(config, {
    method: "GET",
    path: `${config.igUserId}/content_publishing_limit`,
    query: { fields: "quota_usage,config" },
    token: config.pageAccessToken,
  });

  const row =
    Array.isArray(data?.data) && data.data.length > 0
      ? (data.data[0] as Record<string, unknown>)
      : {};
  const quotaUsage = typeof row.quota_usage === "number" ? row.quota_usage : 0;
  const rawConfig =
    typeof row.config === "object" && row.config !== null
      ? (row.config as Record<string, unknown>)
      : null;
  const quotaTotal =
    rawConfig && typeof rawConfig.quota_total === "number"
      ? rawConfig.quota_total
      : 100;

  return { quotaUsage, quotaTotal };
}

/**
 * Delete a published post.
 *
 * ⚠️ Availability is CONDITIONAL, and this capability was historically absent
 * altogether. Meta's IG Media node reference (read 2026-09-10) lists Deleting
 * as supported, with the qualifier: "only supports Instagram API with Facebook
 * login only. Non-ad posts, Stories, Reels and entire carousel albums are
 * supported."
 *
 * This module is on the Facebook-login path — META_PAGE_ACCESS_TOKEN is a Page
 * access token — so the qualifier is satisfied on paper. It has NOT been
 * exercised against a real post here (no credentials were available), so treat
 * a failure as expected-ish rather than surprising, and keep manual deletion in
 * the Instagram app as the fallback for cleaning up a test post.
 */
export async function deleteMedia(
  mediaId: string,
  config: InstagramConfig = requireInstagramConfig()
): Promise<void> {
  await graphRequest<unknown>(config, {
    method: "DELETE",
    path: mediaId,
    token: config.pageAccessToken,
  });
}

/**
 * The whole flow: container -> readiness -> publish -> confirm.
 *
 * Returns once the post is published. `permalink` is null when the read-back
 * failed, which means published-but-unconfirmed — deliberately NOT an error,
 * because throwing after a successful publish would report a failure for a post
 * that is live, and the caller would very reasonably retry and double-post.
 */
export async function publishImagePost(
  params: { imageUrl: string; caption?: string },
  config: InstagramConfig = requireInstagramConfig()
): Promise<InstagramPublishResult> {
  const creationId = await createMediaContainer(params, config);
  await waitForContainerReady(creationId, config);
  const mediaId = await publishContainer(creationId, config);

  let permalink: string | null = null;
  try {
    permalink = await getMediaPermalink(mediaId, config);
  } catch {
    // Swallowed on purpose — see the note above.
  }

  return { creationId, mediaId, permalink };
}
