// Client-safe shared types for the Instagram publishing module. No server-only
// imports here (mirrors lib/pdf/types.ts and lib/youtube/types.ts), so a future
// UI can import the error hints and the caption cap for inline validation
// without dragging the Graph client into a client bundle.

export type InstagramErrorCode =
  | "NOT_CONFIGURED"
  | "INVALID_MEDIA_URL"
  | "CAPTION_TOO_LONG"
  | "CONTAINER_FAILED"
  | "CONTAINER_EXPIRED"
  | "CONTAINER_TIMEOUT"
  | "PUBLISH_LIMIT_REACHED"
  | "TOKEN_INVALID"
  | "PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "GRAPH_ERROR";

/**
 * Instagram's caption ceiling.
 *
 * NOT stated anywhere in Meta's content-publishing API reference — this is the
 * long-standing Instagram product limit, not a documented API contract. It is
 * therefore a FAIL-FAST GUARD, not a mirror of a server rule: the point is to
 * reject a 5,000-character caption locally instead of spending a container
 * creation to learn the same thing. If Meta ever accepts more, this rejects a
 * post that would have worked, which is the safe direction to be wrong in.
 */
export const IG_CAPTION_MAX_CHARS = 2200;

/**
 * JPEG is the ONLY accepted image format — Meta's guide is explicit ("Extended
 * JPEG formats such as MPO and JPS are not supported"). PNG is not accepted.
 *
 * This is enforced twice on purpose: here, before a container is created, and
 * again by the storage bucket's allowed_mime_types (see the migration in
 * supabase/migrations). Catching it at upload time is far kinder than catching
 * it at publish time, when the failure arrives as an opaque container error.
 */
export const IG_ACCEPTED_IMAGE_MIME = "image/jpeg";

/** Unpublished containers are dropped by Meta after this long. */
export const IG_CONTAINER_TTL_HOURS = 24;

/** "Instagram accounts are limited to 100 API-published posts within a 24-hour moving period." */
export const IG_DAILY_PUBLISH_LIMIT = 100;

/** Container readiness states returned by GET /{container-id}?fields=status_code. */
export type IgContainerStatus =
  | "EXPIRED"
  | "ERROR"
  | "FINISHED"
  | "IN_PROGRESS"
  | "PUBLISHED";

export interface InstagramPublishResult {
  /** Container id from POST /{ig-user-id}/media. */
  creationId: string;
  /** Published media id from POST /{ig-user-id}/media_publish. */
  mediaId: string;
  /**
   * Public post URL, read back from the media node AFTER publishing.
   *
   * Present only when the read-back succeeded. It exists because a 200 from
   * media_publish is not by itself evidence that a post is visible on the
   * account — confirming the post means fetching the node and getting a
   * permalink back. A null here means "published, but unconfirmed", which is a
   * materially different claim and should be reported as one.
   */
  permalink: string | null;
}

/** Quota reported by GET /{ig-user-id}/content_publishing_limit. */
export interface InstagramPublishingLimit {
  quotaUsage: number;
  quotaTotal: number;
}

/**
 * What GET /debug_token says about a token. `expiresAt === null` means the
 * token does not expire — Meta encodes that as `expires_at: 0`, which is easy
 * to misread as "expired at the epoch" and act on backwards.
 */
export interface InstagramTokenHealth {
  isValid: boolean;
  /** null when the token never expires (long-lived Page tokens). */
  expiresAt: Date | null;
  /** null when it never expires; otherwise whole days remaining, floored. */
  daysRemaining: number | null;
  /** Meta expires an app's access to user data separately from the token. */
  dataAccessExpiresAt: Date | null;
  scopes: string[];
  /** Present when the token is a Page token — the page it impersonates. */
  profileId: string | null;
  appId: string | null;
}

/** Human recovery hints per error code (mirrors PDF_ERROR_HINTS). */
export const INSTAGRAM_ERROR_HINTS: Record<InstagramErrorCode, string> = {
  NOT_CONFIGURED:
    "Instagram publishing isn't set up yet — the Meta credentials are missing.",
  INVALID_MEDIA_URL:
    "The image must be a public HTTPS link to a JPEG that Meta can fetch without signing in.",
  CAPTION_TOO_LONG: `Instagram captions are limited to ${IG_CAPTION_MAX_CHARS} characters.`,
  CONTAINER_FAILED:
    "Instagram couldn't process the image. Check that the link is public and the file is a real JPEG.",
  CONTAINER_EXPIRED:
    "The upload sat unpublished for over 24 hours. Start it again.",
  CONTAINER_TIMEOUT:
    "Instagram is still processing the image. It may finish shortly — try publishing again in a minute.",
  PUBLISH_LIMIT_REACHED:
    "This account has hit Instagram's limit of 100 API posts in 24 hours.",
  TOKEN_INVALID:
    "The Meta access token was rejected. It may have been revoked or expired — a new one is needed.",
  PERMISSION_DENIED:
    "The Meta app is missing a required permission for this account.",
  RATE_LIMITED: "Meta is throttling requests. Wait a few minutes and retry.",
  NETWORK_ERROR: "Couldn't reach Meta's servers. Check the connection.",
  GRAPH_ERROR: "Instagram's API returned an error — the details are in the message.",
};
