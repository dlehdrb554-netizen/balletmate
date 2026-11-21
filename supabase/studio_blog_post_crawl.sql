-- Public Naver Blog post body and image metadata collection.
create table if not exists public.studio_blog_post_crawl_queue (
  source_id bigint primary key references public.studio_blog_sources(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  attempts integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists public.studio_blog_post_contents (
  source_id bigint primary key references public.studio_blog_sources(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  post_url text not null,
  body_text text,
  image_urls jsonb not null default '[]'::jsonb,
  price_evidence text[] not null default '{}',
  schedule_evidence text[] not null default '{}',
  crawl_status text not null default 'partial' check (crawl_status in ('success','partial','unavailable')),
  checked_at timestamptz not null default now()
);

create index if not exists studio_blog_post_queue_status_idx
  on public.studio_blog_post_crawl_queue(status, updated_at);
create index if not exists studio_blog_post_contents_studio_idx
  on public.studio_blog_post_contents(studio_id, checked_at desc);

alter table public.studio_blog_post_crawl_queue enable row level security;
alter table public.studio_blog_post_contents enable row level security;
revoke all on public.studio_blog_post_crawl_queue from anon, authenticated;
revoke all on public.studio_blog_post_contents from anon, authenticated;
grant all on public.studio_blog_post_crawl_queue to service_role;
grant all on public.studio_blog_post_contents to service_role;

insert into public.studio_blog_post_crawl_queue(source_id)
select id from public.studio_blog_sources
on conflict (source_id) do nothing;

-- Automatically enqueue every newly discovered blog post, including posts
-- collected by future NAVER search runs after this migration has been applied.
create or replace function public.enqueue_studio_blog_post_crawl()
returns trigger
language plpgsql
security definer
set search_path = public
as $enqueue$
begin
  insert into public.studio_blog_post_crawl_queue(source_id)
  values (new.id)
  on conflict (source_id) do nothing;
  return new;
end;
$enqueue$;

drop trigger if exists trg_enqueue_studio_blog_post_crawl on public.studio_blog_sources;
create trigger trg_enqueue_studio_blog_post_crawl
after insert on public.studio_blog_sources
for each row execute function public.enqueue_studio_blog_post_crawl();

revoke all on function public.enqueue_studio_blog_post_crawl() from public, anon, authenticated;

create or replace function public.claim_studio_blog_post_jobs(p_limit integer default 2)
returns table(source_id bigint, studio_id uuid, studio_name text, post_url text, title text, attempts integer)
language sql
security definer
set search_path = public
as $$
  with picked as (
    select q.source_id
    from public.studio_blog_post_crawl_queue q
    where q.status = 'pending'
       or (q.status = 'processing' and q.updated_at < now() - interval '20 minutes')
    order by q.updated_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 2), 3))
  ), claimed as (
    update public.studio_blog_post_crawl_queue q
       set status = 'processing', attempts = q.attempts + 1, updated_at = now()
      from picked p
     where q.source_id = p.source_id
    returning q.source_id, q.attempts
  )
  select c.source_id, b.studio_id, s.name, b.post_url, b.title, c.attempts
    from claimed c
    join public.studio_blog_sources b on b.id = c.source_id
    join public.studios s on s.id = b.studio_id;
$$;
revoke all on function public.claim_studio_blog_post_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_studio_blog_post_jobs(integer) to service_role;

do $$
declare old_job record;
begin
  for old_job in select jobid from cron.job where jobname = 'balletmate-naver-blog-post-crawl'
  loop
    perform cron.unschedule(old_job.jobid);
  end loop;
  perform cron.schedule(
    'balletmate-naver-blog-post-crawl',
    '*/5 * * * *',
    $job$
      select net.http_post(
        url := 'https://ykxvcqgdvifogahbbbwr.supabase.co/functions/v1/crawl-studio-blogs',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-crawl-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'balletmate_crawl_worker_secret' limit 1)
        ),
        body := '{"batchSize":2}'::jsonb,
        timeout_milliseconds := 20000
      );
    $job$
  );
end $$;
