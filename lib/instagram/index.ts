// Public surface of the Instagram publishing module.
//
// Nothing in Prism imports this yet — by design. The brief this was built to
// covers the publishing MECHANISM only; what gets posted, and what triggers a
// post, are not scoped and are deliberately not modelled here.
//
// Minimal use, once the four Meta env vars are set:
//
//   import { publishImagePost } from "@/lib/instagram";
//
//   const { mediaId, permalink } = await publishImagePost({
//     imageUrl: "https://<project>.supabase.co/storage/v1/object/public/instagram-media/demo.jpg",
//     caption: "Shipped a thing.",
//   });
//
// Every failure arrives as an InstagramError with a `code` to branch on and a
// message already fit to show a person. Never forward the raw error object to a
// client — forward `{ code, message, hint }`.

export {
  assertFetchableMediaUrl,
  assertValidCaption,
  createMediaContainer,
  deleteMedia,
  getContainerStatus,
  getMediaPermalink,
  getPublishingLimit,
  publishContainer,
  publishImagePost,
  waitForContainerReady,
} from "./client";

export {
  DEFAULT_GRAPH_VERSION,
  REQUIRED_ENV_VARS,
  readInstagramConfig,
  requireInstagramConfig,
  type InstagramConfig,
  type InstagramConfigResult,
  type RequiredEnvVar,
} from "./config";

export { InstagramError, redactSecrets } from "./errors";

export {
  INSTAGRAM_MEDIA_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  publicMediaUrl,
  signedMediaUrl,
  uploadInstagramImage,
} from "./media-url";

export {
  TOKEN_RENEWAL_THRESHOLD_DAYS,
  checkConfiguredToken,
  describeTokenHealth,
  exchangeForLongLivedUserToken,
  fetchLongLivedPageToken,
  inspectToken,
  needsRenewal,
  refreshInstagramUserToken,
} from "./token";

export {
  IG_ACCEPTED_IMAGE_MIME,
  IG_CAPTION_MAX_CHARS,
  IG_CONTAINER_TTL_HOURS,
  IG_DAILY_PUBLISH_LIMIT,
  INSTAGRAM_ERROR_HINTS,
  type IgContainerStatus,
  type InstagramErrorCode,
  type InstagramPublishResult,
  type InstagramPublishingLimit,
  type InstagramTokenHealth,
} from "./types";
