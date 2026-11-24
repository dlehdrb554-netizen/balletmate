-- Remove photos collected from the exact Weseb apartment-board page the user excluded.
-- Safe to run repeatedly. This does not delete studios or unrelated photo sources.

CREATE TEMP TABLE blocked_weseb_photo_urls ON COMMIT DROP AS
SELECT DISTINCT studio_id, image_url
FROM public.studio_photo_candidates
WHERE lower(source_page_url) LIKE '%weseb.com/sjb/m.php%'
  AND lower(source_page_url) LIKE '%board=apartment%'
  AND lower(source_page_url) LIKE '%command=body%'
  AND lower(source_page_url) LIKE '%no=16737%';

-- Remove already-approved copies from the studio gallery.
UPDATE public.studios s
SET image_urls = ARRAY(
  SELECT u
  FROM unnest(COALESCE(s.image_urls, ARRAY[]::text[])) AS u
  WHERE NOT EXISTS (
    SELECT 1 FROM blocked_weseb_photo_urls b
    WHERE b.studio_id = s.id AND b.image_url = u
  )
)
WHERE EXISTS (SELECT 1 FROM blocked_weseb_photo_urls b WHERE b.studio_id = s.id);

-- Remove copies attached to published schedule and price image galleries.
UPDATE public.studio_public_schedules p
SET image_urls = ARRAY(
  SELECT u FROM unnest(COALESCE(p.image_urls, ARRAY[]::text[])) AS u
  WHERE NOT EXISTS (
    SELECT 1 FROM blocked_weseb_photo_urls b
    WHERE b.studio_id = p.studio_id AND b.image_url = u
  )
)
WHERE EXISTS (SELECT 1 FROM blocked_weseb_photo_urls b WHERE b.studio_id = p.studio_id);

UPDATE public.studio_public_prices p
SET image_urls = ARRAY(
  SELECT u FROM unnest(COALESCE(p.image_urls, ARRAY[]::text[])) AS u
  WHERE NOT EXISTS (
    SELECT 1 FROM blocked_weseb_photo_urls b
    WHERE b.studio_id = p.studio_id AND b.image_url = u
  )
)
WHERE EXISTS (SELECT 1 FROM blocked_weseb_photo_urls b WHERE b.studio_id = p.studio_id);

-- Delete the excluded candidates, including already approved/rejected records.
DELETE FROM public.studio_photo_candidates c
WHERE lower(c.source_page_url) LIKE '%weseb.com/sjb/m.php%'
  AND lower(c.source_page_url) LIKE '%board=apartment%'
  AND lower(c.source_page_url) LIKE '%command=body%'
  AND lower(c.source_page_url) LIKE '%no=16737%';

SELECT
  (SELECT count(*) FROM public.studio_photo_candidates
   WHERE lower(source_page_url) LIKE '%weseb.com/sjb/m.php%'
     AND lower(source_page_url) LIKE '%board=apartment%'
     AND lower(source_page_url) LIKE '%command=body%'
     AND lower(source_page_url) LIKE '%no=16737%') AS remaining_blocked_photo_candidates;
