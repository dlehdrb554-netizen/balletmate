-- Studio source provenance only. Photo crawling and photo-review setup were retired.
-- Safe to re-run.
ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS source_name text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;
