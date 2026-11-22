-- Price evidence does not expire automatically; the original post date remains visible.
-- Timetable evidence is considered current for 45 days because class schedules change frequently.
-- Run once in Supabase SQL Editor after studio_public_price_expiry.sql and studio_public_schedules.sql.

ALTER TABLE public.studio_public_prices
  ALTER COLUMN expires_at DROP NOT NULL,
  ALTER COLUMN expires_at DROP DEFAULT;

UPDATE public.studio_public_prices
SET expires_at = NULL
WHERE expires_at IS NOT NULL;

CREATE OR REPLACE VIEW public.studio_public_prices_app
WITH (security_invoker = true) AS
SELECT
  p.id, p.studio_id, p.amount_krw, p.price_period,
  p.frequency_per_week, p.evidence_text, p.source_title,
  p.source_url, p.source_post_date, p.published_at, p.expires_at
FROM public.studio_public_prices p
WHERE p.is_active = true;

GRANT SELECT ON public.studio_public_prices_app TO anon, authenticated;

COMMENT ON COLUMN public.studio_public_prices.expires_at IS
  'Optional manual price expiry. NULL means no automatic expiry; source_post_date is displayed to users.';

ALTER TABLE public.studio_public_schedules
  ALTER COLUMN expires_at SET DEFAULT (CURRENT_DATE + 45);

UPDATE public.studio_public_schedules
SET expires_at = COALESCE(source_post_date + 45, published_at::date + 45)
WHERE is_active = true;

DROP POLICY IF EXISTS "public read active studio schedules" ON public.studio_public_schedules;
CREATE POLICY "public read active studio schedules"
  ON public.studio_public_schedules FOR SELECT
  TO anon, authenticated
  USING (is_active = true AND expires_at >= CURRENT_DATE);

CREATE OR REPLACE VIEW public.studio_public_schedules_app
WITH (security_invoker = true) AS
SELECT
  s.id, s.studio_id, s.schedule_text, s.evidence_text, s.source_title,
  s.source_url, s.source_post_date, s.published_at, s.expires_at
FROM public.studio_public_schedules s
WHERE s.is_active = true
  AND s.expires_at >= CURRENT_DATE;

GRANT SELECT ON public.studio_public_schedules_app TO anon, authenticated;

COMMENT ON COLUMN public.studio_public_schedules.expires_at IS
  'Timetable freshness deadline. Public app shows only schedules within the 45-day freshness window.';
