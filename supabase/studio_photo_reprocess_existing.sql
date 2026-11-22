-- One-time reprocessing migration: queue all currently published gallery images
-- and all previously collected blog images for automatic Gemini Vision classification.
-- Run AFTER studio_photo_review.sql, studio_photo_material_classification.sql,
-- and studio_photo_auto_classification.sql. Then use Admin > Photo auto-process.
-- Safe to run for seeding, but intentionally resets prior classifications to pending.

-- Reset every existing candidate to pending so the AI re-checks historical candidates.
UPDATE public.studio_photo_candidates
SET review_status='pending',
    auto_classification=NULL,
    auto_confidence=NULL,
    auto_reason=NULL,
    auto_classified_at=NULL,
    material_type=NULL,
    reviewed_at=NULL,
    reviewed_by=NULL;

-- Seed all images already in studio galleries.
INSERT INTO public.studio_photo_candidates
  (studio_id,studio_name,image_url,source_page_url,source_host,review_status)
SELECT s.id,s.name,photo.image_url,
       COALESCE(NULLIF(s.website_url,''),NULLIF(s.source_url,''),photo.image_url),
       substring(COALESCE(NULLIF(s.website_url,''),NULLIF(s.source_url,''),photo.image_url) from '^https?://([^/]+)'),
       'pending'
FROM public.studios s
CROSS JOIN LATERAL unnest(COALESCE(s.image_urls,ARRAY[]::text[])) AS photo(image_url)
WHERE photo.image_url ~ '^https://'
ON CONFLICT (studio_id,image_url) DO UPDATE
SET studio_name=EXCLUDED.studio_name,
    source_page_url=EXCLUDED.source_page_url,
    source_host=EXCLUDED.source_host,
    review_status='pending',
    auto_classification=NULL,
    auto_confidence=NULL,
    auto_reason=NULL,
    auto_classified_at=NULL,
    material_type=NULL,
    reviewed_at=NULL,
    reviewed_by=NULL;

-- Seed the full blog-photo history, not just the earlier limited backfill.
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
ON CONFLICT (studio_id,image_url) DO UPDATE
SET studio_name=EXCLUDED.studio_name,
    source_page_url=EXCLUDED.source_page_url,
    source_host=EXCLUDED.source_host,
    review_status='pending',
    auto_classification=NULL,
    auto_confidence=NULL,
    auto_reason=NULL,
    auto_classified_at=NULL,
    material_type=NULL,
    reviewed_at=NULL,
    reviewed_by=NULL;

CREATE INDEX IF NOT EXISTS studio_photo_candidates_pending_auto_idx
  ON public.studio_photo_candidates(review_status,auto_classification,created_at DESC);
