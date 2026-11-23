-- Public fallback: show recent successfully crawled posts linked to an active studio
-- even when the blogger account has not yet been formally verified.
CREATE OR REPLACE FUNCTION public.get_studio_blog_collected_details(p_studio_id uuid)
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
AS $$
  SELECT c.source_id,
    COALESCE(s.title,'제목 미확인') AS title,
    c.post_url,
    s.description,
    s.blogger_name,
    s.post_date,
    left(COALESCE(c.body_text,''),1800) AS body_excerpt,
    COALESCE(c.image_urls,'[]'::jsonb) AS image_urls,
    COALESCE(c.price_evidence,'{}'::text[]) AS price_evidence,
    COALESCE(c.schedule_evidence,'{}'::text[]) AS schedule_evidence,
    c.checked_at
  FROM public.studio_blog_post_contents c
  JOIN public.studio_blog_sources s ON s.id=c.source_id
  JOIN public.studios st ON st.id=c.studio_id
  WHERE c.studio_id=p_studio_id
    AND st.is_active=true
    AND c.crawl_status='success'
  ORDER BY s.post_date DESC NULLS LAST,s.collected_at DESC,c.checked_at DESC
  LIMIT 3;
$$;
REVOKE ALL ON FUNCTION public.get_studio_blog_collected_details(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_studio_blog_collected_details(uuid) TO anon, authenticated;
