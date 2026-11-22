-- Auto-classify and publish or exclude photo candidates; preserve candidate rows for recovery.
-- Run after studio_photo_review.sql, studio_photo_material_classification.sql,
-- and studio_photo_auto_classification.sql.
-- Seed all existing gallery images for AI screening (including previously uploaded ones).
INSERT INTO public.studio_photo_candidates
  (studio_id,studio_name,image_url,source_page_url,source_host,review_status)
SELECT s.id,s.name,photo.image_url,
       COALESCE(NULLIF(s.website_url,''),NULLIF(s.source_url,''),photo.image_url),
       substring(COALESCE(NULLIF(s.website_url,''),NULLIF(s.source_url,''),photo.image_url) from '^https?://([^/]+)'),
       'pending'
FROM public.studios s
CROSS JOIN LATERAL unnest(COALESCE(s.image_urls,ARRAY[]::text[])) AS photo(image_url)
WHERE photo.image_url ~ '^https://'
ON CONFLICT (studio_id,image_url) DO NOTHING;

-- Seed the full collected blog-photo history, not only the earlier limited backfill.
INSERT INTO public.studio_photo_candidates
  (studio_id,studio_name,image_url,source_page_url,source_host,review_status)
SELECT DISTINCT pc.studio_id,s.name,photo.image_url,pc.post_url,
       substring(pc.post_url from '^https?://([^/]+)'),'pending'
FROM public.studio_blog_post_contents pc
JOIN public.studios s ON s.id=pc.studio_id
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(pc.image_urls)='array' THEN pc.image_urls ELSE '[]'::jsonb END
) AS photo(image_url)
WHERE photo.image_url ~ '^https://'
ON CONFLICT (studio_id,image_url) DO NOTHING;

CREATE INDEX IF NOT EXISTS studio_photo_candidates_pending_auto_idx
  ON public.studio_photo_candidates(review_status,auto_classification,created_at DESC);
