// Turning a stored image into a URL Meta can fetch.
//
// SERVER-ONLY — uses the service-role Supabase client.
//
// ── What was actually measured (2026-09-10, live project, not assumed) ───────
//
// The question this module answers is "can Prism's existing Supabase storage
// serve a public URL suitable for Instagram publishing?" The answer is
// QUALIFIED YES — the mechanism works, but not from the bucket that exists.
//
//   1. The only bucket in the project is `pdf-uploads`: public=false,
//      file_size_limit 25 MB, allowed_mime_types ["application/pdf"].
//
//   2. It cannot hold an image at all. Uploading a 1x1 PNG to it returned
//      HTTP 415 `invalid_mime_type` — "mime type image/png is not supported".
//      So this is not a permissions detail to work around; the bucket rejects
//      the bytes.
//
//   3. The /object/public/ route on a PRIVATE bucket returns HTTP 400
//      `{"error":"Bucket not found","code":"NoSuchBucket"}`. Note the error
//      names the BUCKET, not the permission — a private bucket looks exactly
//      like a missing one through the public route, which is worth knowing
//      before losing an hour to a typo hunt.
//
//   4. A SIGNED url on that same private bucket was fetched with NO
//      Authorization header and returned HTTP 200 with the right
//      content-type. Signed URLs are genuinely public-reachable for their TTL,
//      which is the property Meta's fetcher needs.
//
// Hence two supported shapes below. Both need a bucket that accepts JPEG,
// which `pdf-uploads` is not — see supabase/migrations for the one that does.

import { createAdminClient } from "@/lib/supabase/admin";

import { InstagramError } from "./errors";
import { IG_ACCEPTED_IMAGE_MIME } from "./types";

/**
 * Bucket for images destined for Instagram.
 *
 * Separate from `pdf-uploads` rather than a relaxation of it, for two reasons
 * that both matter: that bucket is private and its objects are user documents,
 * and widening its allowed_mime_types to admit images would widen it for every
 * existing uploader too. A publish bucket holds things that are about to be
 * public by definition; a PDF bucket holds things that must not be.
 */
export const INSTAGRAM_MEDIA_BUCKET = "instagram-media";

/**
 * Default lifetime for a signed media URL.
 *
 * One hour, and NOT the few minutes the fetch itself takes. Meta reads
 * image_url during container creation, but a container remains publishable for
 * 24 hours, and a retry after a transient failure re-reads the same URL that
 * was baked into the container. A URL that dies in five minutes turns an
 * ordinary retry into an unexplainable container ERROR. An hour covers the
 * realistic retry window without leaving a long-lived public link behind.
 */
export const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Public URL for an object in a PUBLIC bucket.
 *
 * Permanent and unauthenticated — the right choice when the image is about to
 * be posted publicly anyway, since a signed URL's TTL buys no privacy for a
 * picture that will be on Instagram in a moment.
 *
 * Returns a URL string without checking that the object exists. Supabase
 * builds this path client-side; a wrong path yields a 404 at fetch time, which
 * for our purposes surfaces as a container error from Meta.
 */
export function publicMediaUrl(
  path: string,
  bucket: string = INSTAGRAM_MEDIA_BUCKET
): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!base) {
    throw new InstagramError(
      "NOT_CONFIGURED",
      "NEXT_PUBLIC_SUPABASE_URL is not set, so no media URL can be built"
    );
  }
  const clean = path.replace(/^\/+/, "");
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${clean}`;
}

/**
 * Time-limited public URL for an object in a PRIVATE bucket.
 *
 * Verified reachable with no credentials (see the header note). Use this when
 * the source image should not stay world-readable after the post goes out.
 */
export async function signedMediaUrl(
  path: string,
  options: { bucket?: string; expiresIn?: number } = {}
): Promise<string> {
  const bucket = options.bucket ?? INSTAGRAM_MEDIA_BUCKET;
  const expiresIn = options.expiresIn ?? SIGNED_URL_TTL_SECONDS;

  const { data, error } = await createAdminClient()
    .storage.from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    throw new InstagramError(
      "INVALID_MEDIA_URL",
      `Could not sign a URL for ${bucket}/${path}${
        error?.message ? ` — ${error.message}` : ""
      }`
    );
  }
  return data.signedUrl;
}

/**
 * Upload a JPEG for publishing and return the URL Meta will fetch.
 *
 * The content type is FIXED to image/jpeg rather than taken from the caller.
 * JPEG is the only format Instagram's publishing API accepts, so a parameter
 * here would exist solely to let a caller choose a value that cannot work. The
 * bucket enforces the same restriction server-side; this is the half of the
 * check that produces a comprehensible message.
 */
export async function uploadInstagramImage(
  path: string,
  bytes: Uint8Array | ArrayBuffer | Blob,
  options: { bucket?: string; signed?: boolean; upsert?: boolean } = {}
): Promise<{ path: string; url: string }> {
  const bucket = options.bucket ?? INSTAGRAM_MEDIA_BUCKET;

  const { error } = await createAdminClient()
    .storage.from(bucket)
    .upload(path, bytes, {
      contentType: IG_ACCEPTED_IMAGE_MIME,
      upsert: options.upsert ?? false,
    });

  if (error) {
    throw new InstagramError(
      "INVALID_MEDIA_URL",
      `Could not upload the image to ${bucket} — ${error.message}`
    );
  }

  const url = options.signed
    ? await signedMediaUrl(path, { bucket })
    : publicMediaUrl(path, bucket);

  return { path, url };
}
