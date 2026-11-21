-- Preserve original blog post dates with reviewed evidence and device OCR candidates.
-- Source tables remain service-role only; authenticated admins use copied date fields.
ALTER TABLE public.studio_blog_evidence_candidates
  ADD COLUMN IF NOT EXISTS source_post_date date;

ALTER TABLE public.studio_image_ocr_results
  ADD COLUMN IF NOT EXISTS source_post_date date;

UPDATE public.studio_blog_evidence_candidates ec
SET source_post_date = s.post_date
FROM public.studio_blog_sources s
WHERE s.id = ec.source_id
  AND ec.source_post_date IS NULL;

UPDATE public.studio_image_ocr_results o
SET source_post_date = s.post_date
FROM public.studio_blog_sources s
WHERE s.id = o.source_id
  AND o.source_post_date IS NULL;

CREATE INDEX IF NOT EXISTS studio_blog_evidence_source_date_idx
  ON public.studio_blog_evidence_candidates(source_post_date);
