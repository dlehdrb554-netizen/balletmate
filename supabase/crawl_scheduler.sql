-- Autonomous Balletmate collection scheduler.
-- Replace the placeholder with a long random secret. Set the same value as
-- Edge Function secret CRAWL_WORKER_SECRET. Run after deploying both workers.
-- Set KAKAO_REST_API_KEY separately in Edge Function secrets.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;
do $$ begin
 if not exists(select 1 from vault.secrets where name='balletmate_crawl_worker_secret') then
  perform vault.create_secret('REPLACE_WITH_LONG_RANDOM_SECRET','balletmate_crawl_worker_secret','Balletmate scheduled worker shared secret');
 end if;
end $$;
select cron.unschedule(jobid) from cron.job where jobname in ('balletmate-studio-image-crawl','balletmate-studio-discovery');
select cron.schedule('balletmate-studio-image-crawl','*/2 * * * *',$$
 select net.http_post(url:='https://ykxvcqgdvifogahbbbwr.supabase.co/functions/v1/crawl-studio-worker',headers:=jsonb_build_object('Content-Type','application/json','x-crawl-secret',(select decrypted_secret from vault.decrypted_secrets where name='balletmate_crawl_worker_secret' order by created_at desc limit 1)),body:='{}'::jsonb);
 $$);
select cron.schedule('balletmate-studio-discovery','*/5 * * * *',$$
 select net.http_post(url:='https://ykxvcqgdvifogahbbbwr.supabase.co/functions/v1/studio-discovery-worker',headers:=jsonb_build_object('Content-Type','application/json','x-crawl-secret',(select decrypted_secret from vault.decrypted_secrets where name='balletmate_crawl_worker_secret' order by created_at desc limit 1)),body:='{}'::jsonb);
 $$);
