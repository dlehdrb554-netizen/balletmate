-- Atomic class + weekly-session spreadsheet import for approved studio owners.
-- Run once in the Supabase SQL Editor. Re-runnable.
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS instructor text;

CREATE OR REPLACE FUNCTION public.owner_bulk_import_classes(
  p_studio_id uuid,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $ballet_fn$
DECLARE
  v_row jsonb;
  v_session jsonb;
  v_class_id uuid;
  v_title text;
  v_count integer := 0;
  v_audience text;
  v_duration integer;
  v_price integer;
  v_weekday integer;
  v_start time;
  v_end time;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_studio_owner(p_studio_id) THEN
    RAISE EXCEPTION '승인된 학원 관리자만 수업을 일괄 등록할 수 있습니다.';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) < 1 OR jsonb_array_length(p_rows) > 200 THEN
    RAISE EXCEPTION '등록할 수업은 1~200개까지 선택할 수 있습니다.';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_title := trim(coalesce(v_row->>'title',''));
    v_audience := coalesce(v_row->>'audience','all');
    v_duration := coalesce(nullif(v_row->>'duration_minutes','')::integer,60);
    v_price := nullif(v_row->>'price','')::integer;
    IF v_title = '' OR length(v_title) > 100 THEN RAISE EXCEPTION '수업명이 비어 있거나 너무 깁니다.'; END IF;
    IF v_audience NOT IN ('adult','kids','all') THEN RAISE EXCEPTION '잘못된 수업 대상: %',v_title; END IF;
    IF v_duration NOT BETWEEN 10 AND 240 THEN RAISE EXCEPTION '수업 시간은 10~240분이어야 합니다: %',v_title; END IF;
    IF v_price IS NOT NULL AND v_price < 0 THEN RAISE EXCEPTION '가격은 0원 이상이어야 합니다: %',v_title; END IF;
    IF EXISTS (SELECT 1 FROM public.classes c WHERE c.studio_id=p_studio_id AND lower(trim(c.title))=lower(v_title)) THEN
      RAISE EXCEPTION '이미 등록된 수업명입니다: %',v_title;
    END IF;

    INSERT INTO public.classes(studio_id,title,audience,level,class_type,duration_minutes,price,instructor,is_active)
    VALUES(p_studio_id,v_title,v_audience,nullif(trim(v_row->>'level'),''),nullif(trim(v_row->>'class_type'),''),
      v_duration,v_price,nullif(trim(v_row->>'instructor'),''),true)
    RETURNING id INTO v_class_id;

    IF jsonb_typeof(v_row->'sessions') = 'array' THEN
      FOR v_session IN SELECT value FROM jsonb_array_elements(v_row->'sessions')
      LOOP
        v_weekday := (v_session->>'weekday')::integer;
        v_start := (v_session->>'start_time')::time;
        v_end := nullif(v_session->>'end_time','')::time;
        IF v_weekday NOT BETWEEN 0 AND 6 OR v_start IS NULL THEN
          RAISE EXCEPTION '시간표 정보가 올바르지 않습니다: %',v_title;
        END IF;
        INSERT INTO public.class_sessions(class_id,weekday,start_time,end_time,note,is_active)
        VALUES(v_class_id,v_weekday,v_start,v_end,nullif(v_session->>'note',''),true);
      END LOOP;
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$ballet_fn$;

REVOKE ALL ON FUNCTION public.owner_bulk_import_classes(uuid,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.owner_bulk_import_classes(uuid,jsonb) TO authenticated;
