-- Balletmate data sources: Kakao Local API + NEIS only.
-- NEIS scheduler is configured separately in neis_ballet_discovery.sql.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;
do $$ begin
 if not exists(select 1 from vault.secrets where name='balletmate_crawl_worker_secret') then
  perform vault.create_secret('REPLACE_WITH_LONG_RANDOM_SECRET','balletmate_crawl_worker_secret','Balletmate scheduled worker shared secret');
 end if;
end $$;
do $$
declare j record;
begin
 for j in select jobid from cron.job
  where jobname in ('balletmate-studio-image-crawl','balletmate-studio-discovery','balletmate-studio-website-info','balletmate-kakao-studio-discovery')
     or jobname ilike '%photo%' or jobname ilike '%vision%' or jobname ilike '%image%' or jobname ilike '%blog%'
     or command ilike '%/functions/v1/crawl-studio%'
     or command ilike '%/functions/v1/classify-studio-photo%'
     or command ilike '%/functions/v1/search-studio-blogs%'
 loop perform cron.unschedule(j.jobid); end loop;
end $$;
select cron.schedule('balletmate-kakao-studio-discovery','*/5 * * * *',$$
 select net.http_post(
  url:='https://ykxvcqgdvifogahbbbwr.supabase.co/functions/v1/studio-discovery-worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-crawl-secret',(select decrypted_secret from vault.decrypted_secrets where name='balletmate_crawl_worker_secret' order by created_at desc limit 1)),
  body:='{}'::jsonb
 );
$$);
