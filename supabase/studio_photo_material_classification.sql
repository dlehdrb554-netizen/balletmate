-- Manually classify photo-only studio materials without OCR.
-- Safe to run repeatedly.
ALTER TABLE public.studio_photo_candidates
  ADD COLUMN IF NOT EXISTS material_type text
  CHECK (material_type IS NULL OR material_type IN ('price','schedule','other'));

CREATE INDEX IF NOT EXISTS studio_photo_candidates_material_idx
  ON public.studio_photo_candidates(review_status,material_type,created_at DESC);
