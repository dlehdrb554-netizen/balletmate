-- Public-facing freshness metadata for nationwide studio listings.
-- Read-only view: does not overwrite studio data or automatically claim that a price is current.
-- Apply after studio_public_prices.sql, studio_public_schedules.sql,
-- studio_details_enrichment.sql, and studio_media.sql.

CREATE OR REPLACE VIEW public.studio_information_freshness_app
WITH (security_invoker = true) AS
SELECT
  s.id AS studio_id,
  s.verified_at,
  s.details_checked_at,
  s.image_checked_at,
  CASE
    WHEN s.verified_at IS NULL THEN 'not_checked'
    WHEN s.verified_at < now() - interval '180 days' THEN 'stale'
    ELSE 'recent'
  END AS profile_freshness,
  CASE
    WHEN NULLIF(trim(s.website_url), '') IS NULL THEN 'no_official_site'
    WHEN s.details_checked_at IS NULL THEN 'not_checked'
    WHEN s.details_checked_at < now() - interval '90 days' THEN 'stale'
    ELSE 'recent'
  END AS official_details_freshness,
  CASE
    WHEN COALESCE(cardinality(s.image_urls), 0) = 0 THEN 'no_photos'
    WHEN s.image_checked_at IS NULL THEN 'not_checked'
    WHEN s.image_checked_at < now() - interval '180 days' THEN 'stale'
    ELSE 'recent'
  END AS photo_freshness,
  price.latest_price_date,
  CASE
    WHEN price.latest_price_date IS NULL THEN 'no_published_price'
    ELSE 'source_date_visible'
  END AS price_freshness,
  schedule.latest_schedule_date,
  schedule.latest_schedule_expiry,
  CASE
    WHEN schedule.latest_schedule_expiry IS NULL THEN 'no_published_schedule'
    ELSE 'current'
  END AS schedule_freshness
FROM public.studios s
LEFT JOIN LATERAL (
  SELECT max(COALESCE(p.source_post_date, p.published_at::date)) AS latest_price_date
  FROM public.studio_public_prices p
  WHERE p.studio_id = s.id AND p.is_active = true
) price ON true
LEFT JOIN LATERAL (
  SELECT
    max(COALESCE(sc.source_post_date, sc.published_at::date)) AS latest_schedule_date,
    max(sc.expires_at) AS latest_schedule_expiry
  FROM public.studio_public_schedules sc
  WHERE sc.studio_id = s.id AND sc.is_active = true
) schedule ON true
WHERE s.is_active = true;

GRANT SELECT ON public.studio_information_freshness_app TO anon, authenticated;

COMMENT ON VIEW public.studio_information_freshness_app IS
  'Read-only freshness labels for active studios. Price dates are shown as source dates, not treated as proof that prices remain current. Schedule status follows the configured expiry policy.';
