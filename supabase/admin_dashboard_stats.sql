-- Admin-only operational overview for the active Kakao + NEIS pipeline.
-- Safe to re-run. No photo or blog crawler counters.
CREATE OR REPLACE FUNCTION public.balletmate_admin_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.is_balletmate_admin() THEN
  RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object(
  'studios',jsonb_build_object(
   'total',(SELECT count(*) FROM public.studios),
   'active',(SELECT count(*) FROM public.studios WHERE coalesce(is_active,true))
  ),
  'reports',jsonb_build_object(
   'pending',(SELECT count(*) FROM public.studio_user_reports WHERE status='pending'),
   'in_review',(SELECT count(*) FROM public.studio_user_reports WHERE status='in_review'),
   'resolved',(SELECT count(*) FROM public.studio_user_reports WHERE status='resolved')
  ),
  'public_prices',jsonb_build_object(
   'active',(SELECT count(*) FROM public.studio_public_prices WHERE is_active AND expires_at>=CURRENT_DATE)
  ),
  'public_schedules',jsonb_build_object(
   'active',(SELECT count(*) FROM public.studio_public_schedules WHERE is_active AND expires_at>=CURRENT_DATE)
  ),
  'discovery',jsonb_build_object(
   'last_region',(SELECT region_name FROM public.studio_discovery_runs ORDER BY queried_at DESC LIMIT 1),
   'last_run_at',(SELECT queried_at FROM public.studio_discovery_runs ORDER BY queried_at DESC LIMIT 1),
   'last_inserted',(SELECT inserted_count FROM public.studio_discovery_runs ORDER BY queried_at DESC LIMIT 1),
   'last_error',(SELECT error FROM public.studio_discovery_runs ORDER BY queried_at DESC LIMIT 1)
  )
 ) INTO result;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.balletmate_admin_dashboard_stats() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.balletmate_admin_dashboard_stats() TO authenticated;
