-- Extend local OCR records with provenance and structured, unverified candidates.
-- Safe to re-run.
ALTER TABLE public.studio_image_ocr_results
  ADD COLUMN IF NOT EXISTS source_id bigint REFERENCES public.studio_blog_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS amount_krw integer,
  ADD COLUMN IF NOT EXISTS price_period text,
  ADD COLUMN IF NOT EXISTS frequency_per_week integer,
  ADD COLUMN IF NOT EXISTS schedule_days text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS schedule_time text;

CREATE UNIQUE INDEX IF NOT EXISTS studio_image_ocr_source_image_uidx
  ON public.studio_image_ocr_results(source_id, image_url);

CREATE INDEX IF NOT EXISTS studio_image_ocr_amount_idx
  ON public.studio_image_ocr_results(studio_id, amount_krw)
  WHERE amount_krw IS NOT NULL;

COMMENT ON COLUMN public.studio_image_ocr_results.amount_krw IS
  'OCR-derived price candidate only; requires admin source-image verification before publishing.';
