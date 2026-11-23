-- Read-only audit: why NEIS-only academies are not appearing on the map.
-- Run in Supabase SQL Editor. No data is modified.

SELECT jsonb_pretty(jsonb_build_object(
  'candidate_status_counts', (
    SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
    FROM (
      SELECT kakao_status, review_status, eligible, is_open,
             count(*) AS total,
             count(*) FILTER (WHERE matched_studio_id IS NOT NULL) AS linked,
             count(*) FILTER (WHERE matched_studio_id IS NULL) AS unlinked,
             count(*) FILTER (WHERE nullif(trim(address),'') IS NOT NULL) AS with_address,
             count(*) FILTER (WHERE nullif(trim(address),'') IS NULL) AS without_address
      FROM public.neis_ballet_academy_candidates
      GROUP BY kakao_status, review_status, eligible, is_open
      ORDER BY eligible DESC, is_open DESC, kakao_status, review_status
    ) x
  ),
  'eligible_unlinked_samples', (
    SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
    FROM (
      SELECT id, academy_name, district_name, address, academy_phone,
             kakao_status, kakao_match_reason, kakao_checked_at, review_status
      FROM public.neis_ballet_academy_candidates
      WHERE eligible = true AND is_open = true AND matched_studio_id IS NULL
      ORDER BY last_seen_at DESC NULLS LAST, id
      LIMIT 50
    ) x
  ),
  'recent_verification_runs', (
    SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
    FROM (
      SELECT id, candidate_id, query_text, result_count, status, reason, checked_at
      FROM public.neis_ballet_kakao_verification_runs
      ORDER BY checked_at DESC
      LIMIT 30
    ) x
  ),
  'neis_only_rows', (
    SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
    FROM (
      SELECT id, name, address, latitude, longitude, source_status, neis_candidate_id
      FROM public.studios
      WHERE source_status = 'neis_only'
      ORDER BY created_at DESC
      LIMIT 50
    ) x
  ),
  'kakao_verification_cron', (
    SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
    FROM (
      SELECT jobid, jobname, schedule, active
      FROM cron.job
      WHERE jobname IN ('balletmate-neis-kakao-verification','balletmate-neis-academy-discovery')
      ORDER BY jobname
    ) x
  )
)) AS neis_only_discovery_audit;
