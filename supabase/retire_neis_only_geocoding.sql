-- Retire the obsolete NEIS-address geocoding schedule.
-- Keep legacy geocoding columns and records intact for audit; no studio rows are deleted.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname='balletmate-neis-only-geocoding';
