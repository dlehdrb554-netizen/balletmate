ALTER TABLE public.studio_photo_candidates
 ADD COLUMN IF NOT EXISTS auto_classification text CHECK (auto_classification IS NULL OR auto_classification IN ('ballet_class','schedule','price','poster','logo','portrait','unrelated','unknown')),
 ADD COLUMN IF NOT EXISTS auto_confidence numeric(4,3),
 ADD COLUMN IF NOT EXISTS auto_reason text,
 ADD COLUMN IF NOT EXISTS auto_classified_at timestamptz;
CREATE INDEX IF NOT EXISTS studio_photo_candidates_auto_classification_idx ON public.studio_photo_candidates(review_status,auto_classification,auto_classified_at DESC);

-- Bound automatic Vision retries so a permanently broken image cannot occupy
-- the queue forever. Re-running this migration is safe.
ALTER TABLE public.studio_photo_candidates
 ADD COLUMN IF NOT EXISTS auto_retry_count integer NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS auto_retry_exhausted_at timestamptz;

UPDATE public.studio_photo_candidates
SET auto_retry_count = 0
WHERE auto_retry_count IS NULL;

ALTER TABLE public.studio_photo_candidates
 DROP CONSTRAINT IF EXISTS studio_photo_candidates_auto_retry_count_check;
ALTER TABLE public.studio_photo_candidates
 ADD CONSTRAINT studio_photo_candidates_auto_retry_count_check
 CHECK (auto_retry_count >= 0 AND auto_retry_count <= 3);

CREATE INDEX IF NOT EXISTS studio_photo_candidates_vision_retry_idx
 ON public.studio_photo_candidates(review_status, auto_retry_count, auto_classified_at, created_at);
