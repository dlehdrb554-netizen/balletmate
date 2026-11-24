-- Admin-only global pending official Naver blog candidate review.
-- Run once in Supabase SQL Editor after studio_blog_account_discovery.sql.

CREATE OR REPLACE FUNCTION public.admin_list_all_studio_blog_account_candidates(
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id bigint,
  studio_id uuid,
  studio_name text,
  district text,
  address text,
  blogger_url text,
  blogger_name text,
  matched_post_count integer,
  sample_posts jsonb,
  match_score integer,
  review_status text,
  last_seen_at timestamptz,
  total_count bigint
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
  SELECT
    c.id,
    c.studio_id,
    c.studio_name,
    s.district,
    s.address,
    c.blogger_url,
    c.blogger_name,
    c.matched_post_count,
    c.sample_posts,
    c.match_score,
    c.review_status,
    c.last_seen_at,
    count(*) OVER () AS total_count
  FROM public.studio_blog_account_candidates c
  JOIN public.studios s ON s.id = c.studio_id
  WHERE c.review_status = 'pending'
  ORDER BY c.match_score DESC, c.matched_post_count DESC,
           c.last_seen_at DESC, c.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_all_studio_blog_account_candidates(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_all_studio_blog_account_candidates(integer, integer) TO authenticated;
