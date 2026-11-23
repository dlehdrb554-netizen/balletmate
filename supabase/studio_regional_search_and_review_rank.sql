-- Daily regional discovery trends and public review ranking.
-- Only query text and region are stored; no raw phone, IP, or device identifiers.
CREATE TABLE IF NOT EXISTS public.studio_search_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  region text NOT NULL,
  query text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_search_events_region_created_idx
  ON public.studio_search_events(region,created_at DESC);
ALTER TABLE public.studio_search_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_search_events FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.record_studio_search(p_region text,p_query text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_region text:=trim(coalesce(p_region,'전체')); v_query text:=trim(coalesce(p_query,''));
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF length(v_query)<2 OR length(v_query)>60 THEN RETURN false; END IF;
  IF v_query ~* '^(발레|발레학원|학원|검색)$' THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.studio_search_events
    WHERE user_id=auth.uid() AND lower(query)=lower(v_query) AND region=v_region
      AND created_at>now()-interval '5 minutes') THEN RETURN false; END IF;
  INSERT INTO public.studio_search_events(user_id,region,query)
    VALUES(auth.uid(),v_region,v_query);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_studio_search(text,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.record_studio_search(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_studio_search_rank(p_region text DEFAULT '전체')
RETURNS TABLE(query text,search_count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$
  SELECT e.query,count(*)::bigint AS search_count
  FROM public.studio_search_events e
  WHERE e.created_at>=date_trunc('day',now())
    AND (coalesce(p_region,'전체')='전체' OR e.region=p_region)
  GROUP BY e.query ORDER BY search_count DESC,e.query ASC LIMIT 10;
$$;
REVOKE ALL ON FUNCTION public.get_studio_search_rank(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_studio_search_rank(text) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_studio_review_rank(p_region text DEFAULT '전체')
RETURNS TABLE(studio_id uuid,studio_name text,review_count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$
  SELECT s.id,s.name,count(r.id)::bigint AS review_count
  FROM public.studios s
  JOIN public.studio_reviews r ON r.studio_id=s.id
  WHERE coalesce(s.is_active,true)
    AND (coalesce(p_region,'전체')='전체' OR coalesce(s.district,'지역 정보 없음')=p_region)
    AND NOT EXISTS(SELECT 1 FROM public.studio_owners o WHERE o.user_id=r.user_id)
    AND NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=r.user_id
      AND coalesce(u.raw_app_meta_data->>'role','') IN ('admin','balletmate_admin'))
  GROUP BY s.id,s.name
  ORDER BY review_count DESC,s.name ASC LIMIT 10;
$$;
REVOKE ALL ON FUNCTION public.get_studio_review_rank(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_studio_review_rank(text) TO anon,authenticated;
