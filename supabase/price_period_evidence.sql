-- Store the billing period separately from the extracted KRW amount.
-- Safe to run more than once.
ALTER TABLE public.studio_blog_evidence_candidates
  ADD COLUMN IF NOT EXISTS price_period text NOT NULL DEFAULT '기간 미확인',
  ADD COLUMN IF NOT EXISTS price_frequency_per_week integer;

ALTER TABLE public.studio_blog_evidence_candidates
  DROP CONSTRAINT IF EXISTS studio_blog_evidence_candidates_frequency_check;

ALTER TABLE public.studio_blog_evidence_candidates
  ADD CONSTRAINT studio_blog_evidence_candidates_frequency_check
  CHECK (price_frequency_per_week IS NULL OR price_frequency_per_week BETWEEN 1 AND 14);
