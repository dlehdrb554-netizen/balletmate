-- Balletmate admin review + Kakao Place-only official links + photo thumbnails.
-- Run this entire file once in Supabase SQL Editor. Safe to re-run.

-- Source: supabase/studio_blog_evidence_admin_delete.sql
-- Admin-only permanent deletion for incorrect extracted price/schedule evidence candidates.
-- The linked source post and crawl record are intentionally preserved.
CREATE OR REPLACE FUNCTION public.admin_delete_studio_blog_evidence_candidates(
  p_candidate_ids bigint[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(cardinality(p_candidate_ids), 0) = 0 THEN
    RETURN 0;
  END IF;

  DELETE FROM public.studio_blog_evidence_candidates
  WHERE id = ANY(p_candidate_ids);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_studio_blog_evidence_candidates(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_studio_blog_evidence_candidates(bigint[]) TO authenticated;


-- Source: supabase/studio_photo_candidate_admin_delete.sql
-- Admin-only permanent deletion of a photo candidate from the review queue.
-- Approved gallery photos remain in studios.image_urls; remove those separately
-- from the studio's photo gallery if they should no longer be displayed.
CREATE OR REPLACE FUNCTION public.admin_delete_studio_photo_candidate(
  p_candidate_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.studio_photo_candidates
  WHERE id = p_candidate_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_studio_photo_candidate(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_studio_photo_candidate(bigint) TO authenticated;


-- Source: supabase/studio_kakao_only_official_links_and_photo_thumbnails.sql
-- Keep official website/blog links strictly sourced from Kakao Place.
-- Existing unverified Naver homepage guesses are cleared; manually verified and
-- Kakao Place-sourced URLs are preserved.
UPDATE public.studios
SET website_url = NULL,
    source_name = NULL,
    updated_at = now()
WHERE source_name ILIKE '%Naver 홈페이지 검색 후보%';

-- Hide legacy Naver-search blog candidates from the admin candidate list.
-- Candidate rows are retained for audit; only Kakao Place-listed account seeds
-- are eligible for official account management and public blog content.
CREATE OR REPLACE FUNCTION public.admin_list_studio_blog_account_candidates(p_studio_id uuid)
RETURNS TABLE(
  id bigint,
  blogger_url text,
  blogger_name text,
  matched_post_count integer,
  sample_posts jsonb,
  match_score integer,
  review_status text,
  last_seen_at timestamptz
)
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
  SELECT c.id, c.blogger_url, c.blogger_name, c.matched_post_count,
         c.sample_posts, c.match_score, c.review_status, c.last_seen_at
  FROM public.studio_blog_account_candidates c
  JOIN public.studios s ON s.id = c.studio_id
  WHERE c.studio_id = p_studio_id
    AND s.source_url ~* '^https?://place[.]map[.]kakao[.]com/'
    AND c.blogger_name = '카카오 장소 등록 블로그'
  ORDER BY CASE c.review_status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
           c.last_seen_at DESC
  LIMIT 30;
END;
$function$;

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
  JOIN public.studios s ON s.id = a.studio_id
  JOIN public.studio_blog_account_candidates c
    ON c.studio_id = a.studio_id
   AND c.blogger_url = a.blogger_url
   AND c.blogger_name = '카카오 장소 등록 블로그'
  WHERE a.studio_id = p_studio_id
    AND a.is_active = true
    AND s.source_url ~* '^https?://place[.]map[.]kakao[.]com/'
  ORDER BY a.verified_at DESC, a.id DESC;
END;
$function$;

-- Public blog posts are visible only when the same account is explicitly listed
-- in that academy's Kakao Place profile.
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
    AND st.source_url ~* '^https?://place[.]map[.]kakao[.]com/'
    AND c.crawl_status = 'success'
    AND q.status = 'completed'
    AND EXISTS (
      SELECT 1
      FROM public.studio_blog_official_accounts oa
      JOIN public.studio_blog_account_candidates ca
        ON ca.studio_id = oa.studio_id
       AND ca.blogger_url = oa.blogger_url
       AND ca.blogger_name = '카카오 장소 등록 블로그'
      WHERE oa.is_active = true
        AND oa.studio_id = st.id
        AND lower(split_part(regexp_replace(trim(oa.blogger_url), '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1))
          = lower(split_part(regexp_replace(trim(COALESCE(src.blogger_url, '')), '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1))
    )
  ORDER BY src.post_date DESC NULLS LAST, src.collected_at DESC, c.checked_at DESC
  LIMIT 3;
$function$;

REVOKE ALL ON FUNCTION public.get_studio_blog_public_details(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_studio_blog_public_details(uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_list_studio_blog_account_candidates(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_studio_official_blog_accounts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_studio_blog_account_candidates(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_studio_official_blog_accounts(uuid) TO authenticated;

-- Ensure previously approved photo candidates are reflected in studios.image_urls,
-- which supplies the thumbnail shown in map/list cards. Existing gallery order wins.
WITH all_images AS (
  SELECT s.id AS studio_id, u.image_url, u.ord::bigint AS ord
  FROM public.studios s
  CROSS JOIN LATERAL unnest(COALESCE(s.image_urls, ARRAY[]::text[]))
    WITH ORDINALITY AS u(image_url, ord)

  UNION ALL

  SELECT p.studio_id, p.image_url,
         (1000000 + row_number() OVER (
           PARTITION BY p.studio_id ORDER BY p.reviewed_at DESC NULLS LAST, p.id DESC
         ))::bigint AS ord
  FROM public.studio_photo_candidates p
  WHERE p.review_status = 'approved'
),
deduped AS (
  SELECT studio_id, image_url, min(ord) AS ord
  FROM all_images
  WHERE image_url ~* '^https://'
  GROUP BY studio_id, image_url
),
ranked AS (
  SELECT studio_id, image_url,
         row_number() OVER (PARTITION BY studio_id ORDER BY ord) AS rn
  FROM deduped
),
merged AS (
  SELECT studio_id, array_agg(image_url ORDER BY rn) AS image_urls
  FROM ranked
  WHERE rn <= 10
  GROUP BY studio_id
)
UPDATE public.studios s
SET image_urls = m.image_urls,
    image_source_name = COALESCE(NULLIF(s.image_source_name, ''), '관리자 검수 사진'),
    updated_at = now()
FROM merged m
WHERE m.studio_id = s.id
  AND COALESCE(s.image_urls, ARRAY[]::text[]) IS DISTINCT FROM m.image_urls;
