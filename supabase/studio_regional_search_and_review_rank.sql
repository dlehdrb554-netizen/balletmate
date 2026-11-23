-- Popularity metrics: authenticated detail views (unique per user/studio/day) and favorites.
CREATE TABLE IF NOT EXISTS public.studio_detail_view_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  event_date date
);
CREATE INDEX IF NOT EXISTS studio_detail_view_events_studio_time_idx ON public.studio_detail_view_events(studio_id,created_at DESC);
ALTER TABLE public.studio_detail_view_events ADD COLUMN IF NOT EXISTS event_date date;
UPDATE public.studio_detail_view_events SET event_date=(created_at AT TIME ZONE 'Asia/Seoul')::date WHERE event_date IS NULL;
DELETE FROM public.studio_detail_view_events a USING public.studio_detail_view_events b
 WHERE a.user_id=b.user_id AND a.studio_id=b.studio_id AND a.event_date=b.event_date AND a.id>b.id
   AND a.user_id IS NOT NULL;
ALTER TABLE public.studio_detail_view_events ALTER COLUMN event_date SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS studio_detail_view_events_user_studio_day_uidx
 ON public.studio_detail_view_events(user_id,studio_id,event_date);
ALTER TABLE public.studio_detail_view_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_detail_view_events FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.record_studio_detail_view(p_studio_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $ballet$
DECLARE v_inserted integer;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.studios WHERE id=p_studio_id AND coalesce(is_active,true)) THEN RETURN false; END IF;
 DELETE FROM public.studio_detail_view_events WHERE created_at<now()-interval '30 days';
 INSERT INTO public.studio_detail_view_events(user_id,studio_id,event_date)
 VALUES(auth.uid(),p_studio_id,(now() AT TIME ZONE 'Asia/Seoul')::date)
 ON CONFLICT(user_id,studio_id,event_date) DO NOTHING;
 GET DIAGNOSTICS v_inserted=ROW_COUNT;
 RETURN v_inserted>0;
END; $ballet$;
REVOKE ALL ON FUNCTION public.record_studio_detail_view(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.record_studio_detail_view(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_studio_popular_views_rank(p_region text DEFAULT '전체')
RETURNS TABLE(studio_id uuid,studio_name text,view_count bigint,favorite_count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $ballet$
 SELECT s.id,s.name,count(DISTINCT v.user_id)::bigint AS view_count,
  (SELECT count(DISTINCT f.user_id)::bigint FROM public.user_favorites f WHERE f.studio_id=s.id::text
   AND NOT EXISTS(SELECT 1 FROM public.studio_owners o WHERE o.user_id=f.user_id)
   AND NOT EXISTS(SELECT 1 FROM public.admin_users a WHERE a.user_id=f.user_id)
   AND NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=f.user_id AND coalesce(u.raw_app_meta_data->>'role','') IN ('admin','balletmate_admin'))) AS favorite_count
 FROM public.studios s LEFT JOIN public.studio_detail_view_events v ON v.studio_id=s.id
  AND v.created_at>now()-interval '7 days'
  AND NOT EXISTS(SELECT 1 FROM public.studio_owners o WHERE o.user_id=v.user_id)
  AND NOT EXISTS(SELECT 1 FROM public.admin_users a WHERE a.user_id=v.user_id)
  AND NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=v.user_id AND coalesce(u.raw_app_meta_data->>'role','') IN ('admin','balletmate_admin'))
 WHERE coalesce(s.is_active,true) AND (coalesce(p_region,'전체')='전체' OR coalesce(s.district,'지역 정보 없음')=p_region)
 GROUP BY s.id,s.name ORDER BY view_count DESC,s.name ASC LIMIT 10;
$ballet$;
REVOKE ALL ON FUNCTION public.get_studio_popular_views_rank(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_studio_popular_views_rank(text) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_studio_favorite_rank(p_region text DEFAULT '전체')
RETURNS TABLE(studio_id uuid,studio_name text,favorite_count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $ballet$
 SELECT s.id,s.name,count(DISTINCT f.user_id)::bigint
 FROM public.studios s JOIN public.user_favorites f ON f.studio_id=s.id::text
 WHERE coalesce(s.is_active,true) AND (coalesce(p_region,'전체')='전체' OR coalesce(s.district,'지역 정보 없음')=p_region)
  AND NOT EXISTS(SELECT 1 FROM public.studio_owners o WHERE o.user_id=f.user_id)
  AND NOT EXISTS(SELECT 1 FROM public.admin_users a WHERE a.user_id=f.user_id)
  AND NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=f.user_id AND coalesce(u.raw_app_meta_data->>'role','') IN ('admin','balletmate_admin'))
 GROUP BY s.id,s.name ORDER BY count(DISTINCT f.user_id) DESC,s.name ASC LIMIT 10;
$ballet$;
REVOKE ALL ON FUNCTION public.get_studio_favorite_rank(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_studio_favorite_rank(text) TO anon,authenticated;
