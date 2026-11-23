-- Independent, retryable NEIS-only address geocoding queue.
-- Does not merge ambiguous Kakao results and does not overwrite Kakao source data.

ALTER TABLE public.neis_ballet_academy_candidates
  ADD COLUMN IF NOT EXISTS geocode_status text NOT NULL DEFAULT 'pending'
    CHECK (geocode_status IN ('pending','processing','completed','failed','manual_review')),
  ADD COLUMN IF NOT EXISTS geocode_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS geocode_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS geocode_error text,
  ADD COLUMN IF NOT EXISTS geocoded_studio_id uuid
    REFERENCES public.studios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS neis_candidates_geocode_queue_idx
  ON public.neis_ballet_academy_candidates
    (kakao_status, geocode_status, geocode_checked_at)
  WHERE eligible = true AND is_open = true;

-- Existing NEIS-only rows are linked idempotently where the candidate reference exists.
UPDATE public.neis_ballet_academy_candidates c
SET geocode_status='completed',
    geocoded_studio_id=s.id,
    geocode_error=NULL,
    geocode_checked_at=coalesce(c.geocode_checked_at,now())
FROM public.studios s
WHERE s.neis_candidate_id=c.id
  AND s.source_status='neis_only'
  AND c.geocode_status IS DISTINCT FROM 'completed';

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname='balletmate-neis-only-geocoding';

SELECT cron.schedule(
  'balletmate-neis-only-geocoding',
  '*/10 * * * *',
  $$
    SELECT net.http_post(
      url:='https://ykxvcqgdvifogahbbbwr.supabase.co/functions/v1/neis-only-geocoding',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'x-crawl-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name='balletmate_crawl_worker_secret'
          ORDER BY created_at DESC LIMIT 1)
      ),
      body:='{}'::jsonb,
      timeout_milliseconds:=30000
    );
  $$
);

-- Read-only queue health after applying this migration.
SELECT
  kakao_status,
  geocode_status,
  count(*) AS total,
  count(*) FILTER (WHERE matched_studio_id IS NULL) AS without_studio_link,
  count(*) FILTER (WHERE nullif(trim(address),'') IS NOT NULL) AS with_address,
  count(*) FILTER (WHERE geocode_attempts >= 3) AS max_attempts_reached
FROM public.neis_ballet_academy_candidates
WHERE eligible=true AND is_open=true
GROUP BY kakao_status, geocode_status
ORDER BY kakao_status, geocode_status;
