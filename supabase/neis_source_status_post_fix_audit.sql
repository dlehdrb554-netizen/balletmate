-- Post-fix audit for NEIS/Kakao source classification and map propagation.
-- Read-only. Run in Supabase SQL Editor.

SELECT jsonb_pretty(jsonb_build_object(
  'studio_source_status_counts', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'source_status', x.source_status,
      'total', x.total,
      'active_total', x.active_total,
      'missing_coordinates', x.missing_coordinates
    ) ORDER BY x.source_status)
    FROM (
      SELECT source_status, count(*) AS total,
             count(*) FILTER (WHERE is_active) AS active_total,
             count(*) FILTER (WHERE latitude IS NULL OR longitude IS NULL) AS missing_coordinates
      FROM public.studios
      GROUP BY source_status
    ) x
  ), '[]'::jsonb),
  'neis_link_status_audit', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'candidate_id', c.id,
      'candidate_name', c.academy_name,
      'kakao_status', c.kakao_status,
      'review_status', c.review_status,
      'candidate_kakao_place_url', c.kakao_place_url,
      'studio_id', s.id,
      'studio_name', s.name,
      'studio_source_status', s.source_status,
      'studio_source_url', s.source_url,
      'exact_kakao_url_match', (NULLIF(c.kakao_place_url,'') IS NOT NULL AND s.source_url = c.kakao_place_url)
    ) ORDER BY c.id)
    FROM public.neis_ballet_academy_candidates c
    JOIN public.studios s ON s.id = c.matched_studio_id
    WHERE c.eligible = true AND c.is_open = true
  ), '[]'::jsonb),
  'invalid_both_rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'studio_id', s.id, 'studio_name', s.name, 'source_url', s.source_url,
      'candidate_id', c.id, 'candidate_kakao_status', c.kakao_status,
      'candidate_kakao_place_url', c.kakao_place_url
    ))
    FROM public.studios s
    LEFT JOIN public.neis_ballet_academy_candidates c
      ON c.id = s.neis_candidate_id AND c.matched_studio_id = s.id
    WHERE s.source_status = 'both'
      AND (c.id IS NULL OR c.eligible IS DISTINCT FROM true OR c.is_open IS DISTINCT FROM true
           OR c.kakao_status IS DISTINCT FROM 'matched'
           OR NULLIF(c.kakao_place_url,'') IS NULL
           OR s.source_url IS DISTINCT FROM c.kakao_place_url)
  ), '[]'::jsonb),
  'map_source_view_columns', COALESCE((
    SELECT jsonb_agg(column_name ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='studio_map_search_app_with_source'
  ), '[]'::jsonb),
  'map_source_view_counts', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('source_status',x.source_status,'total',x.total) ORDER BY x.source_status)
    FROM (
      SELECT source_status, count(*) AS total
      FROM public.studio_map_search_app_with_source
      GROUP BY source_status
    ) x
  ), '[]'::jsonb),
  'neis_only_studios', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',id,'name',name,'address',address,'latitude',latitude,'longitude',longitude
    ) ORDER BY name)
    FROM public.studios WHERE source_status='neis_only' AND is_active=true
  ), '[]'::jsonb)
)) AS source_status_post_fix_audit;
