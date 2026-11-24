-- Backfill the public-facing official link from an active official Naver blog account.
-- Preserve any existing website/channel URL entered by an owner or administrator.
UPDATE public.studios s
SET website_url = (
  SELECT a.blogger_url
  FROM public.studio_blog_official_accounts a
  WHERE a.studio_id = s.id
    AND a.is_active = true
  ORDER BY a.verified_at DESC NULLS LAST, a.id DESC
  LIMIT 1
),
updated_at = now()
WHERE (s.website_url IS NULL OR btrim(s.website_url) = '')
  AND EXISTS (
    SELECT 1
    FROM public.studio_blog_official_accounts a
    WHERE a.studio_id = s.id
      AND a.is_active = true
  );

-- studios.website_url is the single public-facing "official website/channel" field.
-- Official blog accounts remain the internal source for automatic Naver post collection.
