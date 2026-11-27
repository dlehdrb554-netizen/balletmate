-- Run only after pause_and_protect_studio_discovery.sql has succeeded
-- and the deletion-exclusion table/trigger have been verified.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

select cron.unschedule(jobid)
from cron.job
where jobname in (
 'balletmate-kakao-studio-discovery',
 'balletmate-neis-academy-discovery',
 'balletmate-neis-kakao-verification'
);

-- One region per hour: 123-region cycle is about 5 days.
select cron.schedule('balletmate-kakao-studio-discovery','0 * * * *',$$
 select net.http_post(
  url:='https://ykxvcqgdvifogahbbbwr.supabase.co/functions/v1/studio-discovery-worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-crawl-secret',(select decrypted_secret from vault.decrypted_secrets where name='balletmate_crawl_worker_secret' order by created_at desc limit 1)),
  body:='{}'::jsonb
 );
$$);

-- One NEIS office batch every 6 hours.
select cron.schedule('balletmate-neis-academy-discovery','0 */6 * * *',$$
 select net.http_post(
  url:='https://ykxvcqgdvifogahbbbwr.supabase.co/functions/v1/neis-ballet-discovery',
  headers:=jsonb_build_object('Content-Type','application/json','x-crawl-secret',(select decrypted_secret from vault.decrypted_secrets where name='balletmate_crawl_worker_secret' order by created_at desc limit 1)),
  body:='{}'::jsonb
 );
$$);

-- Verify at most 5 pending NEIS candidates per hour.
select cron.schedule('balletmate-neis-kakao-verification','30 * * * *',$$
 select net.http_post(
  url:='https://ykxvcqgdvifogahbbbwr.supabase.co/functions/v1/neis-ballet-kakao-verification',
  headers:=jsonb_build_object('Content-Type','application/json','x-crawl-secret',(select decrypted_secret from vault.decrypted_secrets where name='balletmate_crawl_worker_secret' order by created_at desc limit 1)),
  body:='{}'::jsonb,
  timeout_milliseconds:=30000
 );
$$);
