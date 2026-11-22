-- Attach multiple optimized photos to an administrator-reviewed price or schedule material.
-- Run once in Supabase SQL Editor. Existing published records remain valid.
ALTER TABLE public.studio_public_prices
  ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.studio_public_schedules
  ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE VIEW public.studio_public_prices_app
WITH (security_invoker = true) AS
SELECT
  p.id, p.studio_id, p.amount_krw, p.price_period,
  p.frequency_per_week, p.evidence_text, p.source_title,
  p.source_url, p.source_post_date, p.published_at, p.expires_at, p.image_urls
FROM public.studio_public_prices p
WHERE p.is_active = true;

GRANT SELECT ON public.studio_public_prices_app TO anon, authenticated;

CREATE OR REPLACE VIEW public.studio_public_schedules_app
WITH (security_invoker = true) AS
SELECT
  s.id, s.studio_id, s.schedule_text, s.evidence_text, s.source_title,
  s.source_url, s.source_post_date, s.published_at, s.expires_at, s.image_urls
FROM public.studio_public_schedules s
WHERE s.is_active = true
  AND s.expires_at >= CURRENT_DATE;

GRANT SELECT ON public.studio_public_schedules_app TO anon, authenticated;

COMMENT ON COLUMN public.studio_public_prices.image_urls IS
  'Up to eight administrator-reviewed, optimized images attached to this published price material.';
COMMENT ON COLUMN public.studio_public_schedules.image_urls IS
  'Up to eight administrator-reviewed, optimized images attached to this published schedule material.';
