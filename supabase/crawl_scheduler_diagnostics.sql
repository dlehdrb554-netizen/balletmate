-- Balletmate scheduled worker diagnostics. Safe read-only queries; no secrets are displayed.
-- 1) Confirm both pg_cron jobs exist and are enabled.
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN ('balletmate-studio-image-crawl','balletmate-studio-discovery')
ORDER BY jobname;

-- 2) Recent scheduler execution results. "succeeded" only means the SQL job ran,
-- not that the HTTP Edge Function returned 200.
SELECT jobid, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid IN (
  SELECT jobid FROM cron.job
  WHERE jobname IN ('balletmate-studio-image-crawl','balletmate-studio-discovery')
)
ORDER BY start_time DESC
LIMIT 12;

-- 3) Actual HTTP responses from pg_net. This is the key worker health check.
SELECT id, status_code, content, error_msg, created
FROM net._http_response
ORDER BY created DESC
LIMIT 12;

-- 4) Verify that the Vault secret exists without revealing its value.
SELECT name, created_at
FROM vault.secrets
WHERE name = 'balletmate_crawl_worker_secret';

-- 5) Candidate backlog and retry status.
SELECT review_status, auto_retry_count,
       (auto_retry_exhausted_at IS NOT NULL) AS retry_exhausted,
       COUNT(*) AS candidate_count
FROM public.studio_photo_candidates
GROUP BY review_status, auto_retry_count, retry_exhausted
ORDER BY review_status, auto_retry_count;
