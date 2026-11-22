-- Public academy detail linkage and official-blog publication policy.
-- Safe to run repeatedly in Supabase SQL Editor.

-- Rebuild the map search view so columns added to studios after its first
-- creation (images and homepage evidence) are present in the view definition.
DROP VIEW IF EXISTS public.studio_map_search_app;
CREATE VIEW public.studio_map_search_app
WITH (security_invoker = true) AS
SELECT
  s.*,
  COALESCE((
    SELECT array_agg(DISTINCT CASE WHEN cs.weekday BETWEEN 1 AND 5 THEN '평일' ELSE '주말' END)
    FROM public.classes c
    JOIN public.class_sessions cs ON cs.class_id = c.id
    WHERE c.studio_id = s.id AND c.is_active = true AND cs.is_active = true
  ), ARRAY[]::text[]) AS search_days,
  COALESCE((
    SELECT array_agg(DISTINCT CASE
      WHEN cs.start_time < TIME '12:00' THEN '오전'
      WHEN cs.start_time < TIME '18:00' THEN '오후'
      ELSE '저녁' END)
    FROM public.classes c
    JOIN public.class_sessions cs ON cs.class_id = c.id
    WHERE c.studio_id = s.id AND c.is_active = true AND cs.is_active = true
  ), ARRAY[]::text[]) AS search_time_slots,
  COALESCE((
    SELECT array_agg(DISTINCT c.level)
    FROM public.classes c
    WHERE c.studio_id = s.id AND c.is_active = true AND c.level IS NOT NULL AND length(trim(c.level)) > 0
  ), ARRAY[]::text[]) AS search_levels,
  COALESCE((
    SELECT array_agg(DISTINCT c.duration_minutes)
    FROM public.classes c
    WHERE c.studio_id = s.id AND c.is_active = true AND c.duration_minutes IS NOT NULL
  ), ARRAY[]::integer[]) AS search_class_durations,
  (
    SELECT min(c.price)
    FROM public.classes c
    WHERE c.studio_id = s.id AND c.is_active = true AND c.price IS NOT NULL
  ) AS search_price,
  COALESCE((
    SELECT bool_or(c.audience IN ('adult','all'))
    FROM public.classes c WHERE c.studio_id = s.id AND c.is_active = true
  ), false) AS search_adult,
  COALESCE((
    SELECT bool_or(c.audience IN ('kids','all'))
    FROM public.classes c WHERE c.studio_id = s.id AND c.is_active = true
  ), false) AS search_kids
FROM public.studios s
WHERE s.is_active = true;

GRANT SELECT ON public.studio_map_search_app TO anon, authenticated;

-- Public blog posts: only completed posts from a verified official account.
-- Collection itself remains unchanged and can continue to collect third-party posts.
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
    COALESCE(s.title, '제목 미확인') AS title,
    c.post_url,
    s.description,
    s.blogger_name,
    s.post_date,
    left(COALESCE(c.body_text, ''), 1800) AS body_excerpt,
    COALESCE(c.image_urls, '[]'::jsonb) AS image_urls,
    COALESCE(c.price_evidence, '{}'::text[]) AS price_evidence,
    COALESCE(c.schedule_evidence, '{}'::text[]) AS schedule_evidence,
    c.checked_at
  FROM public.studio_blog_post_contents c
  JOIN public.studio_blog_sources s ON s.id = c.source_id
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
        AND (oa.studio_id = st.id OR (oa.studio_id IS NULL AND oa.studio_name = st.name))
        AND lower(split_part(regexp_replace(trim(oa.blogger_url), '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1))
          = lower(split_part(regexp_replace(trim(COALESCE(s.blogger_url, '')), '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1))
    )
  ORDER BY s.post_date DESC NULLS LAST, s.collected_at DESC, c.checked_at DESC
  LIMIT 3;
$function$;

REVOKE ALL ON FUNCTION public.get_studio_blog_public_details(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_studio_blog_public_details(uuid) TO anon, authenticated;

-- Diagnostic result: show five academies with the most linked data first.
-- Include pipeline-stage counts so empty public fields can be traced to their source.
WITH diagnostic AS (
  SELECT
    st.id,
    st.name,
    st.website_url,
    st.homepage_search_checked_at,
    (st.price_per_class IS NOT NULL) AS has_map_price,
    cardinality(COALESCE(st.image_urls, ARRAY[]::text[])) AS official_image_count,
    (SELECT count(*) FROM public.classes cl WHERE cl.studio_id = st.id AND cl.is_active = true) AS active_class_count,
    (SELECT count(*) FROM public.class_sessions cs JOIN public.classes cl ON cl.id = cs.class_id
      WHERE cl.studio_id = st.id AND cl.is_active = true AND cs.is_active = true) AS active_session_count,
    (SELECT count(*) FROM public.studio_public_prices pp WHERE pp.studio_id = st.id AND pp.is_active = true) AS approved_price_count,
    (SELECT count(*) FROM public.studio_public_schedules ps WHERE ps.studio_id = st.id AND ps.is_active = true AND ps.expires_at >= CURRENT_DATE) AS approved_schedule_count,
    (SELECT count(*) FROM public.studio_blog_official_accounts oa WHERE (oa.studio_id = st.id OR (oa.studio_id IS NULL AND oa.studio_name = st.name)) AND oa.is_active = true) AS verified_official_blog_count,
    (SELECT count(*) FROM public.studio_blog_sources bs WHERE bs.studio_id = st.id) AS collected_blog_post_count,
    (SELECT count(*) FROM public.studio_blog_post_contents bc WHERE bc.studio_id = st.id AND bc.crawl_status = 'success') AS completed_blog_crawl_count,
    (SELECT count(*) FROM public.studio_blog_evidence_candidates ec WHERE ec.studio_id = st.id AND ec.review_status = 'pending') AS pending_evidence_count
  FROM public.studios st
  WHERE st.is_active = true
)
SELECT *
FROM diagnostic
ORDER BY
  (official_image_count
   + active_class_count
   + active_session_count
   + approved_price_count
   + approved_schedule_count
   + verified_official_blog_count
   + collected_blog_post_count
   + completed_blog_crawl_count
   + pending_evidence_count) DESC,
  name
LIMIT 5;
