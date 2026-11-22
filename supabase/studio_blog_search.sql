-- NAVER API HUB blog discovery queue for Balletmate.
create table if not exists public.studio_blog_search_queue (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  attempts integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists public.studio_blog_sources (
  id bigint generated always as identity primary key,
  studio_id uuid not null references public.studios(id) on delete cascade,
  search_query text not null,
  title text not null,
  post_url text not null,
  description text,
  blogger_name text,
  blogger_url text,
  post_date date,
  collected_at timestamptz not null default now(),
  unique (studio_id, post_url)
);

create index if not exists studio_blog_sources_studio_date_idx
  on public.studio_blog_sources (studio_id, post_date desc nulls last);
create index if not exists studio_blog_queue_status_updated_idx
  on public.studio_blog_search_queue (status, updated_at);

alter table public.studio_blog_search_queue enable row level security;
alter table public.studio_blog_sources enable row level security;

-- Only service-role Edge Functions may read/write the collection queue and source records.
revoke all on public.studio_blog_search_queue from anon, authenticated;
revoke all on public.studio_blog_sources from anon, authenticated;
grant all on public.studio_blog_search_queue to service_role;
grant all on public.studio_blog_sources to service_role;
grant usage, select on sequence public.studio_blog_sources_id_seq to service_role;

insert into public.studio_blog_search_queue (studio_id)
select id from public.studios where coalesce(is_active, true)
on conflict (studio_id) do nothing;

-- Automatically enqueue new discoveries and studios that are activated later.
-- Existing queue rows are preserved; inactive studios are not added.
create or replace function public.enqueue_studio_blog_search_for_active_studio()
returns trigger
language plpgsql
security definer
set search_path = public
as $
begin
  if coalesce(new.is_active, true)
     and (tg_op = 'INSERT' or old.is_active is distinct from new.is_active) then
    insert into public.studio_blog_search_queue(studio_id,status,attempts,last_error,updated_at)
    values(new.id,'pending',0,null,now())
    on conflict(studio_id) do update
      set status='pending',attempts=0,last_error=null,updated_at=now();
  end if;
  return new;
end;
$;

drop trigger if exists studios_enqueue_blog_search on public.studios;
create trigger studios_enqueue_blog_search
  after insert or update of is_active on public.studios
  for each row execute function public.enqueue_studio_blog_search_for_active_studio();

-- Backfill any active studios that were added after the first queue migration.
insert into public.studio_blog_search_queue(studio_id)
select id from public.studios where coalesce(is_active,true)
on conflict(studio_id) do nothing;

create or replace function public.claim_studio_blog_search_jobs(p_limit integer default 3)
returns table(studio_id uuid, studio_name text, attempts integer)
language sql
security definer
set search_path = public
as $$
  with picked as (
    select q.studio_id
    from public.studio_blog_search_queue q
    where q.status = 'pending'
       or (q.status = 'processing' and q.updated_at < now() - interval '20 minutes')
    order by q.updated_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 3), 5))
  ), claimed as (
    update public.studio_blog_search_queue q
       set status = 'processing', attempts = q.attempts + 1, updated_at = now()
      from picked p
     where q.studio_id = p.studio_id
    returning q.studio_id, q.attempts
  )
  select c.studio_id, s.name, c.attempts
    from claimed c join public.studios s on s.id = c.studio_id;
$$;

revoke all on function public.claim_studio_blog_search_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_studio_blog_search_jobs(integer) to service_role;

-- Search is throttled to one small batch every five minutes.
do $$
declare old_job record;
begin
  for old_job in select jobid from cron.job where jobname = 'balletmate-naver-blog-search'
  loop
    perform cron.unschedule(old_job.jobid);
  end loop;
  perform cron.schedule(
    'balletmate-naver-blog-search',
    '*/5 * * * *',
    $job$
      select net.http_post(
        url := 'https://ykxvcqgdvifogahbbbwr.supabase.co/functions/v1/search-studio-blogs',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-crawl-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'balletmate_crawl_worker_secret' limit 1)
        ),
        body := '{"batchSize":3}'::jsonb,
        timeout_milliseconds := 15000
      );
    $job$
  );
end $$;
