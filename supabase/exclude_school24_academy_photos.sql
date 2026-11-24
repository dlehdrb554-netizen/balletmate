-- Remove photos collected from the specifically excluded School24 academy page.
-- Safe to run repeatedly. This does not delete studio records or other School24 pages.

BEGIN;

CREATE TEMP TABLE _school24_blocked_photo_urls ON COMMIT DROP AS
SELECT DISTINCT image_url
FROM public.studio_photo_candidates
WHERE lower(coalesce(source_page_url,'')) ~ '^https?://(www\\.)?school24\\.kr/academy/a/j10-3000069628/?([?#]|$)';

UPDATE public.studios AS s
SET image_urls = ARRAY(
  SELECT item.url
  FROM unnest(coalesce(s.image_urls, ARRAY[]::text[])) WITH ORDINALITY AS item(url, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM _school24_blocked_photo_urls AS blocked WHERE blocked.image_url = item.url
  )
  ORDER BY item.ord
), updated_at = now()
WHERE EXISTS (
  SELECT 1 FROM _school24_blocked_photo_urls AS blocked
  WHERE blocked.image_url = ANY(coalesce(s.image_urls, ARRAY[]::text[]))
);

UPDATE public.studio_public_schedules AS s
SET image_urls = ARRAY(
  SELECT item.url
  FROM unnest(coalesce(s.image_urls, ARRAY[]::text[])) WITH ORDINALITY AS item(url, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM _school24_blocked_photo_urls AS blocked WHERE blocked.image_url = item.url
  )
  ORDER BY item.ord
)
WHERE EXISTS (
  SELECT 1 FROM _school24_blocked_photo_urls AS blocked
  WHERE blocked.image_url = ANY(coalesce(s.image_urls, ARRAY[]::text[]))
);

UPDATE public.studio_public_prices AS p
SET image_urls = ARRAY(
  SELECT item.url
  FROM unnest(coalesce(p.image_urls, ARRAY[]::text[])) WITH ORDINALITY AS item(url, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM _school24_blocked_photo_urls AS blocked WHERE blocked.image_url = item.url
  )
  ORDER BY item.ord
)
WHERE EXISTS (
  SELECT 1 FROM _school24_blocked_photo_urls AS blocked
  WHERE blocked.image_url = ANY(coalesce(p.image_urls, ARRAY[]::text[]))
);

DELETE FROM public.studio_photo_candidates
WHERE lower(coalesce(source_page_url,'')) ~ '^https?://(www\\.)?school24\\.kr/academy/a/j10-3000069628/?([?#]|$)';

COMMIT;

SELECT count(*) AS remaining_school24_candidates
FROM public.studio_photo_candidates
WHERE lower(coalesce(source_page_url,'')) ~ '^https?://(www\\.)?school24\\.kr/academy/a/j10-3000069628/?([?#]|$)';
