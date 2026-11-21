-- Price freshness and admin deactivation.
-- Run after studio_public_prices.sql. Safe to re-run.
ALTER TABLE public.studio_public_prices
  ADD COLUMN IF NOT EXISTS expires_at date;

UPDATE public.studio_public_prices
SET expires_at = COALESCE(source_post_date + 180, published_at::date + 180)
WHERE expires_at IS NULL;

ALTER TABLE public.studio_public_prices
  ALTER COLUMN expires_at SET DEFAULT (CURRENT_DATE + 180),
  ALTER COLUMN expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS studio_public_prices_expiry_idx
  ON public.studio_public_prices(is_active, expires_at);

CREATE OR REPLACE VIEW public.studio_public_prices_app
WITH (security_invoker = true) AS
SELECT
  p.id, p.studio_id, p.amount_krw, p.price_period,
  p.frequency_per_week, p.evidence_text, p.source_title,
  p.source_url, p.source_post_date, p.published_at, p.expires_at
FROM public.studio_public_prices p
WHERE p.is_active = true
  AND p.expires_at >= CURRENT_DATE;

GRANT SELECT ON public.studio_public_prices_app TO anon, authenticated;

COMMENT ON COLUMN public.studio_public_prices.expires_at IS
  'Price evidence freshness deadline. Public view hides rows after this date.';
