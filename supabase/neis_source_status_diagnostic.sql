-- Diagnose the six NEIS-linked studios still marked kakao_only,
-- and inspect the deployed map view definition. Read-only.
SELECT jsonb_pretty(jsonb_build_object(
  'linked_studios', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'studio_id',s.id,'studio_name',s.name,'source_status',s.source_status,
      'source_url',s.source_url,'source_name',s.source_name,'neis_candidate_id',s.neis_candidate_id,
      'candidate_id',c.id,'candidate_name',c.academy_name,
      'candidate_review_status',c.review_status,'candidate_kakao_status',c.kakao_status,
      'candidate_kakao_place_url',c.kakao_place_url,'candidate_kakao_name',c.kakao_name,
      'candidate_eligible',c.eligible,'candidate_is_open',c.is_open
    ) ORDER BY s.name)
    FROM public.studios s
    JOIN public.neis_ballet_academy_candidates c ON c.matched_studio_id=s.id
    WHERE s.source_status='kakao_only' AND c.eligible=true AND c.is_open=true
  ),'[]'::jsonb),
  'map_view_definition', (
    SELECT pg_get_viewdef('public.studio_map_search_app'::regclass,true)
  ),
  'map_view_columns', COALESCE((
    SELECT jsonb_agg(column_name ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='studio_map_search_app'
  ),'[]'::jsonb)
)) AS source_status_diagnostic;
