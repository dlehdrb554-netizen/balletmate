-- Balletmate NEIS/Kakao source-status audit (read-only)
-- Run in Supabase SQL Editor after neis_ballet_pipeline_upgrade.sql.
-- Returns one JSON row so all audit sections can be copied back together.

WITH studio_counts AS (
  SELECT source_status, count(*)::int AS total,
         count(*) FILTER (WHERE is_active)::int AS active_total,
         count(*) FILTER (WHERE latitude IS NULL OR longitude IS NULL)::int AS missing_coordinates
  FROM public.studios
  GROUP BY source_status
),
candidate_counts AS (
  SELECT kakao_status, review_status, count(*)::int AS total
  FROM public.neis_ballet_academy_candidates
  WHERE eligible = true AND is_open = true
  GROUP BY kakao_status, review_status
),
both_invalid AS (
  SELECT s.id, s.name, s.source_status, s.neis_candidate_id,
         c.id AS candidate_id, c.academy_name, c.eligible, c.is_open, c.kakao_status
  FROM public.studios s
  LEFT JOIN public.neis_ballet_academy_candidates c ON c.id=s.neis_candidate_id
  WHERE s.source_status='both'
    AND (c.id IS NULL OR c.eligible IS DISTINCT FROM true OR c.is_open IS DISTINCT FROM true)
  ORDER BY s.name LIMIT 30
),
kakao_linked AS (
  SELECT s.id, s.name, s.neis_candidate_id, c.academy_name, c.review_status, c.kakao_status
  FROM public.studios s
  JOIN public.neis_ballet_academy_candidates c ON c.matched_studio_id=s.id
  WHERE s.source_status='kakao_only' AND c.eligible=true AND c.is_open=true
  ORDER BY s.name LIMIT 30
),
neis_invalid AS (
  SELECT s.id, s.name, s.neis_candidate_id, s.address, s.latitude, s.longitude
  FROM public.studios s
  LEFT JOIN public.neis_ballet_academy_candidates c ON c.id=s.neis_candidate_id
  WHERE s.source_status='neis_only'
    AND (c.id IS NULL OR c.eligible IS DISTINCT FROM true OR c.is_open IS DISTINCT FROM true
         OR s.latitude IS NULL OR s.longitude IS NULL)
  ORDER BY s.name LIMIT 30
),
duplicate_links AS (
  SELECT c.matched_studio_id, count(*)::int AS candidate_count,
         jsonb_agg(jsonb_build_object('id',c.id,'name',c.academy_name,'kakao_status',c.kakao_status)) AS candidates
  FROM public.neis_ballet_academy_candidates c
  WHERE c.matched_studio_id IS NOT NULL AND c.eligible=true AND c.is_open=true
  GROUP BY c.matched_studio_id HAVING count(*)>1
  ORDER BY count(*) DESC LIMIT 30
),
unlinked_neis AS (
  SELECT c.id, c.academy_name, c.address, c.kakao_status, c.review_status, c.kakao_match_reason
  FROM public.neis_ballet_academy_candidates c
  WHERE c.eligible=true AND c.is_open=true AND c.matched_studio_id IS NULL
  ORDER BY c.updated_at DESC NULLS LAST LIMIT 30
)
SELECT jsonb_pretty(jsonb_build_object(
  'generated_at', now(),
  'studio_source_status_counts', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.source_status) FROM studio_counts x),'[]'::jsonb),
  'eligible_neis_candidate_counts', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.kakao_status,x.review_status) FROM candidate_counts x),'[]'::jsonb),
  'both_but_candidate_invalid', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM both_invalid x),'[]'::jsonb),
  'kakao_only_but_linked_to_neis', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM kakao_linked x),'[]'::jsonb),
  'neis_only_but_invalid', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM neis_invalid x),'[]'::jsonb),
  'duplicate_neis_candidates_linked_to_same_studio', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM duplicate_links x),'[]'::jsonb),
  'eligible_neis_candidates_without_studio_link', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM unlinked_neis x),'[]'::jsonb),
  'map_view_has_source_status', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='studio_map_search_app' AND column_name='source_status'
  )
)) AS source_status_audit;
