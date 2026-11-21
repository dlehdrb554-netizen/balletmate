-- Preserve the original blog post date with each reviewed evidence candidate.
-- The source table is intentionally service-role only; admin clients use this copied date.
ALTER TABLE public.studio_blog_evidence_candidates
  ADD COLUMN IF NOT EXISTS source_post_date date;

UPDATE public.studio_blog_evidence_candidates ec
SET source_post_date = s.post_date
FROM public.studio_blog_sources s
WHERE s.id = ec.source_id
  AND ec.source_post_date IS NULL;

CREATE INDEX IF NOT EXISTS studio_blog_evidence_source_date_idx
  ON public.studio_blog_evidence_candidates(source_post_date);
