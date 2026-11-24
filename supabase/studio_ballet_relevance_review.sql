-- Admin review status for Balletmate studio relevance.
-- Run once in Supabase SQL Editor. Safe to rerun.
-- Existing records become pending so admins can review them without deleting data.

ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS ballet_review_status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.studios
  DROP CONSTRAINT IF EXISTS studios_ballet_review_status_check;

ALTER TABLE public.studios
  ADD CONSTRAINT studios_ballet_review_status_check
  CHECK (ballet_review_status IN ('pending', 'verified', 'excluded'));

CREATE INDEX IF NOT EXISTS idx_studios_ballet_review_status_name
  ON public.studios (ballet_review_status, name);

COMMENT ON COLUMN public.studios.ballet_review_status IS
  'Admin review of whether this studio actually offers ballet classes: pending, verified, excluded.';
