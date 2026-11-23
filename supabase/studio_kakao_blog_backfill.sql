-- Gradual Kakao Place official Naver-blog backfill for existing studios.
-- Supports both http:// and https:// Kakao Place URLs.
-- Safe to run repeatedly in Supabase SQL Editor.
ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS kakao_place_blog_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS kakao_place_blog_checked_at timestamptz;

DROP INDEX IF EXISTS public.studios_kakao_blog_backfill_idx;

CREATE INDEX studios_kakao_blog_backfill_idx
  ON public.studios (kakao_place_blog_attempted_at, created_at)
  WHERE is_active = true
    AND source_url ~ '^https?://place\.map\.kakao\.com/'
    AND kakao_place_blog_checked_at IS NULL;
