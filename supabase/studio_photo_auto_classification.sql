ALTER TABLE public.studio_photo_candidates
 ADD COLUMN IF NOT EXISTS auto_classification text CHECK (auto_classification IS NULL OR auto_classification IN ('ballet_class','schedule','price','poster','logo','portrait','unrelated','unknown')),
 ADD COLUMN IF NOT EXISTS auto_confidence numeric(4,3),
 ADD COLUMN IF NOT EXISTS auto_reason text,
 ADD COLUMN IF NOT EXISTS auto_classified_at timestamptz;
CREATE INDEX IF NOT EXISTS studio_photo_candidates_auto_classification_idx ON public.studio_photo_candidates(review_status,auto_classification,auto_classified_at DESC);
