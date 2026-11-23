-- Gradual Kakao Place official Naver-blog backfill for existing studios.
-- Safe to run repeatedly in Supabase SQL Editor.
ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS kakao_place_blog_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS kakao_place_blog_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS studios_kakao_blog_backfill_idx
  ON public.studios (kakao_place_blog_attempted_at, created_at)
  WHERE is_active = true
    AND source_url LIKE 'https://place.map.kakao.com/%'
    AND kakao_place_blog_checked_at IS NULL;
