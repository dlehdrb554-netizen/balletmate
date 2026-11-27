-- NEIS ballet target eligibility and Kakao verification staging.
-- Keeps original NEIS rows for audit; only eligible candidates enter verification.
ALTER TABLE public.neis_ballet_academy_candidates
  ADD COLUMN IF NOT EXISTS eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS eligibility_reason text,
  ADD COLUMN IF NOT EXISTS kakao_status text NOT NULL DEFAULT 'pending'
    CHECK (kakao_status IN ('pending','processing','matched','manual_review','no_match','failed')),
  ADD COLUMN IF NOT EXISTS kakao_place_id text,
  ADD COLUMN IF NOT EXISTS kakao_name text,
  ADD COLUMN IF NOT EXISTS kakao_address text,
  ADD COLUMN IF NOT EXISTS kakao_phone text,
  ADD COLUMN IF NOT EXISTS kakao_latitude double precision,
  ADD COLUMN IF NOT EXISTS kakao_longitude double precision,
  ADD COLUMN IF NOT EXISTS kakao_place_url text,
  ADD COLUMN IF NOT EXISTS kakao_match_score integer,
  ADD COLUMN IF NOT EXISTS kakao_match_reason text,
  ADD COLUMN IF NOT EXISTS kakao_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS neis_ballet_candidates_eligible_idx
  ON public.neis_ballet_academy_candidates(eligible, review_status, kakao_status);

-- A conservative backfill: ballet in academy name OR 예능 field with ballet course.
UPDATE public.neis_ballet_academy_candidates
SET eligible = is_open AND (
      academy_name ~* '발레|ballet'
      OR (field_name ~* '^예능$'
          AND concat_ws(' ', course_list, course_name, teaching_affiliation) ~* '발레|ballet')
    ),
    eligibility_reason = CASE
      WHEN NOT is_open THEN 'closed_or_paused'
      WHEN academy_name ~* '발레|ballet' THEN 'ballet_name_fallback'
      WHEN field_name ~* '^예능$'
        AND concat_ws(' ', course_list, course_name, teaching_affiliation) ~* '발레|ballet'
        THEN 'arts_ballet_course'
      ELSE 'not_confirmed_ballet'
    END,
    updated_at = now();

DROP VIEW IF EXISTS public.neis_ballet_candidate_review;
CREATE VIEW public.neis_ballet_candidate_review
WITH (security_invoker = true) AS
SELECT
  c.id, c.academy_name, c.district_name, c.address, c.academy_phone,
  c.registration_status, c.is_open, c.field_name, c.teaching_affiliation,
  c.course_list, c.course_name, c.review_status, c.matched_studio_id,
  c.eligible, c.eligibility_reason, c.kakao_status, c.kakao_name,
  c.kakao_address, c.kakao_phone, c.kakao_place_url, c.kakao_match_score,
  c.kakao_match_reason, c.kakao_checked_at,
  CASE
    WHEN c.academy_name ~* '발레|ballet' THEN 'ballet_name_high'
    WHEN c.field_name ~* '^예능$'
      AND concat_ws(' ',c.teaching_affiliation,c.course_list,c.course_name) ~* '발레|ballet'
      THEN 'ballet_course_signal'
    WHEN concat_ws(' ',c.field_name,c.teaching_affiliation,c.course_list,c.course_name) ~* '무용'
      THEN 'dance_related_needs_review'
    ELSE 'weak_or_unclear'
  END AS relevance_bucket,
  CASE
    WHEN nullif(trim(coalesce(c.address,'')),'') IS NULL THEN 'missing_address'
    WHEN nullif(trim(coalesce(c.academy_phone,'')),'') IS NULL THEN 'missing_phone'
    WHEN regexp_replace(coalesce(c.academy_phone,''),'[^0-9]','','g') ~ '^(0{7,}|02?0{6,})$' THEN 'placeholder_phone'
    ELSE 'address_phone_present'
  END AS data_quality,
  CASE
    WHEN NOT c.is_open THEN 'exclude_closed'
    WHEN NOT c.eligible THEN 'exclude_not_ballet_target'
    WHEN c.kakao_status='manual_review' THEN 'manual_kakao_review'
    WHEN c.kakao_status='matched' THEN 'kakao_matched'
    ELSE 'priority_verify'
  END AS review_priority,
  c.last_seen_at,c.created_at,c.updated_at
FROM public.neis_ballet_academy_candidates c;

GRANT SELECT ON public.neis_ballet_candidate_review TO authenticated, service_role;

-- Matching against existing studios only considers eligible, open candidates.
CREATE OR REPLACE FUNCTION public.match_neis_ballet_candidates()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE matched_count integer := 0;
BEGIN
  WITH normalized AS (
    SELECT c.id candidate_id,
      regexp_replace(lower(coalesce(c.academy_name,'')),'[^a-z0-9가-힣]','','g') c_name,
      regexp_replace(lower(coalesce(c.address,'')),'[^a-z0-9가-힣]','','g') c_address,
      regexp_replace(coalesce(c.academy_phone,''),'[^0-9]','','g') c_phone
    FROM public.neis_ballet_academy_candidates c
    WHERE c.review_status='pending' AND c.matched_studio_id IS NULL AND c.eligible=true AND c.is_open=true
  ), studios_normalized AS (
    SELECT s.id studio_id,
      regexp_replace(lower(coalesce(s.name,'')),'[^a-z0-9가-힣]','','g') s_name,
      regexp_replace(lower(coalesce(s.address,'')),'[^a-z0-9가-힣]','','g') s_address,
      regexp_replace(coalesce(s.phone,''),'[^0-9]','','g') s_phone
    FROM public.studios s
  ), possible AS (
    SELECT c.candidate_id,s.studio_id,
      (c.c_name<>'' AND c.c_name=s.s_name) name_match,
      (c.c_address<>'' AND s.s_address<>'' AND c.c_address=s.s_address) address_match,
      (c.c_phone<>'' AND s.s_phone<>'' AND c.c_phone=s.s_phone) phone_match
    FROM normalized c JOIN studios_normalized s ON
      (c.c_name<>'' AND c.c_name=s.s_name AND
       ((c.c_address<>'' AND s.s_address<>'' AND c.c_address=s.s_address)
        OR (c.c_phone<>'' AND s.s_phone<>'' AND c.c_phone=s.s_phone)))
      OR (c.c_address<>'' AND s.s_address<>'' AND c.c_address=s.s_address
          AND c.c_phone<>'' AND s.s_phone<>'' AND c.c_phone=s.s_phone)
  ), confident AS (
    SELECT candidate_id,studio_id FROM possible
    WHERE (name_match AND (address_match OR phone_match)) OR (address_match AND phone_match)
  ), unique_matches AS (
    SELECT candidate_id,(array_agg(studio_id ORDER BY studio_id))[1] studio_id
    FROM confident GROUP BY candidate_id HAVING count(DISTINCT studio_id)=1
  )
  UPDATE public.neis_ballet_academy_candidates c
  SET matched_studio_id=u.studio_id,review_status='matched',updated_at=now()
  FROM unique_matches u WHERE c.id=u.candidate_id;
  GET DIAGNOSTICS matched_count = ROW_COUNT;
  RETURN matched_count;
END;
$$;
REVOKE ALL ON FUNCTION public.match_neis_ballet_candidates() FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.match_neis_ballet_candidates() TO service_role;

-- Kakao verification queue audit log. Results are staged, never auto-inserted into studios.
CREATE TABLE IF NOT EXISTS public.neis_ballet_kakao_verification_runs (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  candidate_id bigint NOT NULL REFERENCES public.neis_ballet_academy_candidates(id) ON DELETE CASCADE,
  query_text text NOT NULL,
  result_count integer NOT NULL DEFAULT 0,
  selected_place_id text,
  match_score integer,
  status text NOT NULL,
  reason text,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS neis_ballet_kakao_runs_candidate_idx
  ON public.neis_ballet_kakao_verification_runs(candidate_id,checked_at DESC);
ALTER TABLE public.neis_ballet_kakao_verification_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.neis_ballet_kakao_verification_runs FROM anon,authenticated;
GRANT ALL ON public.neis_ballet_kakao_verification_runs TO service_role;

-- Run staged Kakao verification slowly to control free-tier/API usage.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='balletmate-neis-kakao-verification';
SELECT cron.schedule('balletmate-neis-kakao-verification','30 * * * *',$$
 SELECT net.http_post(
  url:='https://ykxvcqgdvifogahbbbwr.supabase.co/functions/v1/neis-ballet-kakao-verification',
  headers:=jsonb_build_object('Content-Type','application/json','x-crawl-secret',(select decrypted_secret from vault.decrypted_secrets where name='balletmate_crawl_worker_secret' order by created_at desc limit 1)),
  body:='{}'::jsonb,
  timeout_milliseconds:=30000
 );
$$);


-- Independent source aggregation: Kakao discovery remains valid without NEIS.
ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS source_status text NOT NULL DEFAULT 'kakao_only'
    CHECK (source_status IN ('both','kakao_only','neis_only')),
  ADD COLUMN IF NOT EXISTS neis_candidate_id bigint REFERENCES public.neis_ballet_academy_candidates(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS studios_source_status_idx ON public.studios(source_status);
UPDATE public.studios s SET source_status='both',neis_candidate_id=c.id,updated_at=now()
FROM public.neis_ballet_academy_candidates c
WHERE c.matched_studio_id=s.id AND c.eligible=true AND c.is_open=true;
UPDATE public.studios SET source_status='kakao_only'
WHERE neis_candidate_id IS NULL AND source_status IS DISTINCT FROM 'neis_only';
CREATE OR REPLACE FUNCTION public.sync_neis_kakao_source_status()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer:=0;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 UPDATE public.studios s SET source_status='both',neis_candidate_id=c.id,updated_at=now()
 FROM public.neis_ballet_academy_candidates c
 WHERE c.matched_studio_id=s.id AND c.eligible=true AND c.is_open=true
 AND (s.source_status IS DISTINCT FROM 'both' OR s.neis_candidate_id IS DISTINCT FROM c.id);
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.sync_neis_kakao_source_status() FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_neis_kakao_source_status() TO service_role;
