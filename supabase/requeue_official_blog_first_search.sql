-- Re-run blog discovery for academies with Kakao-linked or verified official Naver blogs.
-- This makes the updated official-feed-first search strategy run against existing records.
UPDATE public.studio_blog_search_queue q
SET status = 'pending',
    attempts = 0,
    last_error = NULL,
    updated_at = now()
FROM public.studios s
WHERE q.studio_id = s.id
  AND coalesce(s.is_active, true)
  AND (
    EXISTS (
      SELECT 1 FROM public.studio_blog_official_accounts a
      WHERE a.is_active = true
        AND (a.studio_id = s.id OR (a.studio_id IS NULL AND a.studio_name = s.name))
    )
    OR EXISTS (
      SELECT 1 FROM public.studio_blog_account_candidates c
      WHERE c.studio_id = s.id
        AND c.match_score >= 95
        AND c.review_status IN ('pending','approved')
    )
  );
