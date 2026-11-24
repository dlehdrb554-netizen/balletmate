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

-- Admin must be able to see manually registered accounts too.
-- Candidate discovery remains Kakao-source-only; manually entered official accounts
-- are not required to exist in the candidate table.
CREATE OR REPLACE FUNCTION public.admin_get_studio_official_blog_accounts(p_studio_id uuid)
RETURNS TABLE(blogger_url text, verified_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'administrator required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT a.blogger_url, a.verified_at
  FROM public.studio_blog_official_accounts a
  WHERE a.studio_id = p_studio_id
    AND a.is_active = true
  ORDER BY a.verified_at DESC NULLS LAST, a.id DESC;
END;
$function$;

-- Public blog posts can come from manually registered accounts as well as
-- Kakao Place-listed accounts. Only active official account profiles are exposed.
CREATE OR REPLACE FUNCTION public.get_studio_blog_public_details(p_studio_id uuid)
RETURNS TABLE (
  source_id bigint,
  title text,
  post_url text,
  description text,
  blogger_name text,
  post_date date,
  body_excerpt text,
  image_urls jsonb,
  price_evidence text[],
  schedule_evidence text[],
  checked_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    c.source_id,
    COALESCE(src.title, '제목 미확인') AS title,
    c.post_url,
    src.description,
    src.blogger_name,
    src.post_date,
    left(COALESCE(c.body_text, ''), 1800) AS body_excerpt,
    COALESCE(c.image_urls, '[]'::jsonb) AS image_urls,
    COALESCE(c.price_evidence, '{}'::text[]) AS price_evidence,
    COALESCE(c.schedule_evidence, '{}'::text[]) AS schedule_evidence,
    c.checked_at
  FROM public.studio_blog_post_contents c
  JOIN public.studio_blog_sources src ON src.id = c.source_id
  JOIN public.studio_blog_post_crawl_queue q ON q.source_id = c.source_id
  JOIN public.studios st ON st.id = c.studio_id
  WHERE c.studio_id = p_studio_id
    AND st.id = p_studio_id
    AND st.is_active = true
    AND c.crawl_status = 'success'
    AND q.status = 'completed'
    AND EXISTS (
      SELECT 1
      FROM public.studio_blog_official_accounts oa
      WHERE oa.is_active = true
        AND oa.studio_id = st.id
        AND lower(split_part(regexp_replace(trim(oa.blogger_url), '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1))
          = lower(split_part(regexp_replace(trim(COALESCE(src.blogger_url, '')), '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1))
    )
  ORDER BY src.post_date DESC NULLS LAST, src.collected_at DESC, c.checked_at DESC
  LIMIT 3;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_studio_official_blog_accounts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_studio_official_blog_accounts(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_studio_blog_public_details(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_studio_blog_public_details(uuid) TO anon, authenticated;
