-- Admin-only management for verified official Naver blog accounts.
-- Run once in Supabase SQL Editor. Public users cannot read or modify this table.

CREATE OR REPLACE FUNCTION public.admin_get_studio_official_blog_accounts(p_studio_id uuid)
RETURNS TABLE(blogger_url text, verified_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE studio_name_value text;
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'administrator required' USING ERRCODE = '42501';
  END IF;

  SELECT s.name INTO studio_name_value
  FROM public.studios s
  WHERE s.id = p_studio_id;

  IF studio_name_value IS NULL THEN
    RAISE EXCEPTION 'studio not found';
  END IF;

  RETURN QUERY
  SELECT a.blogger_url, a.verified_at
  FROM public.studio_blog_official_accounts a
  WHERE a.studio_name = studio_name_value
    AND a.is_active = true
  ORDER BY a.verified_at DESC, a.id DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_studio_official_blog_accounts(
  p_studio_id uuid,
  p_blogger_urls text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  studio_name_value text;
  clean_urls text[];
  inserted_count integer := 0;
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'administrator required' USING ERRCODE = '42501';
  END IF;

  SELECT s.name INTO studio_name_value
  FROM public.studios s
  WHERE s.id = p_studio_id;

  IF studio_name_value IS NULL THEN
    RAISE EXCEPTION 'studio not found';
  END IF;

  SELECT COALESCE(array_agg(url ORDER BY url), ARRAY[]::text[])
  INTO clean_urls
  FROM (
    SELECT DISTINCT trim(value) AS url
    FROM unnest(COALESCE(p_blogger_urls, ARRAY[]::text[])) AS value
    WHERE trim(value) <> ''
  ) normalized;

  IF cardinality(clean_urls) > 5 THEN
    RAISE EXCEPTION '학원별 공식 블로그는 최대 5개까지 등록할 수 있습니다.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(clean_urls) AS value
    WHERE value !~* '^https://(m[.])?blog[.]naver[.]com/[A-Za-z0-9._-]+/?$'
  ) THEN
    RAISE EXCEPTION '네이버 블로그 프로필 주소만 등록할 수 있습니다. 예: https://blog.naver.com/blogid';
  END IF;

  UPDATE public.studio_blog_official_accounts
  SET is_active = false
  WHERE studio_name = studio_name_value
    AND is_active = true;

  INSERT INTO public.studio_blog_official_accounts(studio_name, blogger_url, is_active, verified_at)
  SELECT studio_name_value, value, true, now()
  FROM unnest(clean_urls) AS value
  ON CONFLICT (studio_name, blogger_url)
  DO UPDATE SET is_active = true, verified_at = now();

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_studio_official_blog_accounts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_studio_official_blog_accounts(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_studio_official_blog_accounts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_studio_official_blog_accounts(uuid, text[]) TO authenticated;
