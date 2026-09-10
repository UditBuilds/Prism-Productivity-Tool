-- Public storage bucket for images published to Instagram.
--
-- ⚠️ NOT APPLIED. This file is committed as the ready-to-run answer to "where
-- does the image live", not as a change that has been made. Nothing in the
-- Instagram module creates a bucket at runtime, and the live project still has
-- exactly one bucket (pdf-uploads) as of 2026-09-10.
--
-- WHY A NEW BUCKET AT ALL — measured, not assumed:
--
--   Meta FETCHES the image from image_url; bytes are never uploaded through the
--   API. So the file has to sit somewhere on the public internet at publish
--   time. Probing the live project on 2026-09-10 established:
--
--     * pdf-uploads is public=false with allowed_mime_types
--       ["application/pdf"]. Uploading a PNG to it returns HTTP 415
--       invalid_mime_type — it rejects the bytes, so this is not a policy
--       detail that could be worked around with a signed URL.
--     * The /object/public/ route on a private bucket answers HTTP 400
--       "Bucket not found" (NoSuchBucket) — a private bucket is
--       indistinguishable from a missing one through that route.
--     * A SIGNED url on the private bucket WAS fetched with no Authorization
--       header and returned HTTP 200 with the correct content-type. Signed URLs
--       are therefore a working alternative to a public bucket.
--
--   Widening pdf-uploads to accept images was rejected: it holds users' private
--   documents, and relaxing its MIME list relaxes it for every existing
--   uploader, not just for this feature.
--
-- WHY JPEG ONLY: Meta's content-publishing guide is explicit that "JPEG is the
-- only image format supported. Extended JPEG formats such as MPO and JPS are
-- not supported." Encoding that here means a PNG fails at UPLOAD time with a
-- clear message, instead of at publish time as an opaque container error.
--
-- APPLY-ONCE. Run in the Supabase SQL Editor.

-- 1. The bucket. public = true, so /object/public/<bucket>/<path> resolves for
--    anyone — which is the entire requirement, since Meta fetches it
--    unauthenticated. An image about to appear on a public Instagram feed
--    gains nothing from being private in storage.
--
--    For the alternative shape (keep it private, hand Meta a signed URL), set
--    public = false here and call signedMediaUrl() instead of publicMediaUrl()
--    in lib/instagram/media-url.ts. Both are implemented.
INSERT INTO "storage"."buckets" ("id", "name", "public", "file_size_limit", "allowed_mime_types")
VALUES (
  'instagram-media',
  'instagram-media',
  true,
  8388608,          -- 8 MB. Instagram downscales anything larger anyway, and a
                    -- cap here bounds what a bug can push into public storage.
  ARRAY['image/jpeg']
)
ON CONFLICT ("id") DO NOTHING;

-- 2. Write access is SERVICE-ROLE ONLY.
--
--    No INSERT/UPDATE/DELETE policy is created for authenticated users. That is
--    deliberate: this bucket publishes to a public Instagram account, and the
--    only writer should be server code that has already decided what to post.
--    Service-role bypasses RLS, so lib/instagram/media-url.ts works without a
--    policy; a signed-in user hitting storage directly does not.
--
--    Public READ needs no policy either — bucket.public = true is what serves
--    /object/public/, and it is not gated by storage.objects RLS.

-- 3. Verify after running:
--
--    select id, public, file_size_limit, allowed_mime_types
--      from storage.buckets where id = 'instagram-media';
--
--    Expected: public = true, allowed_mime_types = {image/jpeg}.
