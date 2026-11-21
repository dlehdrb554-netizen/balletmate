-- Balletmate autonomous photo-crawl scheduler (Supabase Free-tier friendly).
-- 1) Replace the placeholder secret below with a long random secret.
-- 2) Add the same secret as Edge Function secret CRAWL_WORKER_SECRET.
-- 3) Run this SQL once after studio_intake.sql and deploying crawl-studio-worker.
-- Re-running safely replaces the named cron job and Vault secret.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

select vault.create_secret(
  'REPLACE_WITH_LONG_RANDOM_SECRET',
  'balletmate_crawl_worker_secret',
  'Shared secret for scheduled studio photo crawl worker'
);

select cron.unschedule(jobid)
from cron.job
where jobname = 'balletmate-studio-image-crawl';

select cron.schedule(
  'balletmate-studio-image-crawl',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://ykxvcqgdvifogahbbbwr.supabase.co/functions/v1/crawl-studio-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-crawl-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'balletmate_crawl_worker_secret'
        limit 1
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
