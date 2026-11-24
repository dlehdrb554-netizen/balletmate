-- Balletmate: clear every stored academy-photo reference and stop photo collection.
-- Safe to re-run. This does not delete community attachments or profile avatars.
BEGIN;

-- Stop the scheduled image/Vision worker. Keep website text-evidence collection enabled.
DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job
    WHERE jobname IN ('balletmate-studio-image-crawl','balletmate-photo-vision','balletmate-studio-photo-vision')
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

-- Remove every academy gallery URL, including manually registered photos.
UPDATE public.studios
SET image_urls=ARRAY[]::text[],
    image_source_name=NULL,
    image_checked_at=NULL,
    updated_at=now()
WHERE COALESCE(cardinality(image_urls),0)>0
   OR image_source_name IS NOT NULL
   OR image_checked_at IS NOT NULL
;

-- Remove photos attached to published price and timetable materials.
UPDATE public.studio_public_prices
SET image_urls=ARRAY[]::text[]
WHERE COALESCE(cardinality(image_urls),0)>0;

UPDATE public.studio_public_schedules
SET image_urls=ARRAY[]::text[]
WHERE COALESCE(cardinality(image_urls),0)>0;

-- Clear Naver post image URL metadata but retain text evidence and post references.
UPDATE public.studio_blog_post_contents
SET image_urls='[]'::jsonb
WHERE image_urls IS DISTINCT FROM '[]'::jsonb;

-- Empty all pending/approved/rejected photo candidates and any source metadata.
DELETE FROM public.studio_photo_candidates;

COMMIT;

-- Storage bucket files are intentionally not deleted through SQL because
-- direct DELETE on storage.objects can orphan the underlying files.
-- Empty the 'studio-photos' bucket in Supabase Dashboard > Storage > studio-photos.
