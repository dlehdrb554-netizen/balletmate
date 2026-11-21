-- Distribute blog-post crawling fairly across studios.
-- Run after studio_blog_post_crawl.sql. Does not alter the existing cron schedule.
create or replace function public.claim_studio_blog_post_jobs(p_limit integer default 2)
returns table(source_id bigint, studio_id uuid, studio_name text, post_url text, title text, attempts integer)
language sql
security definer
set search_path = public
as $$
  with ranked as (
    select
      q.source_id,
      b.studio_id,
      q.updated_at,
      row_number() over (
        partition by b.studio_id
        order by q.updated_at asc, q.source_id asc
      ) as studio_rank
    from public.studio_blog_post_crawl_queue q
    join public.studio_blog_sources b on b.id = q.source_id
    where q.status = 'pending'
       or (q.status = 'processing' and q.updated_at < now() - interval '20 minutes')
  ),
  picked as (
    select q.source_id
    from public.studio_blog_post_crawl_queue q
    join ranked r on r.source_id = q.source_id
    order by r.studio_rank asc, r.updated_at asc, r.source_id asc
    for update of q skip locked
    limit greatest(1, least(coalesce(p_limit, 2), 3))
  ),
  claimed as (
    update public.studio_blog_post_crawl_queue q
       set status = 'processing',
           attempts = q.attempts + 1,
           updated_at = now()
      from picked p
     where q.source_id = p.source_id
    returning q.source_id, q.attempts
  )
  select
    c.source_id,
    b.studio_id,
    s.name,
    b.post_url,
    b.title,
    c.attempts
  from claimed c
  join public.studio_blog_sources b on b.id = c.source_id
  join public.studios s on s.id = b.studio_id;
$$;

revoke all on function public.claim_studio_blog_post_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_studio_blog_post_jobs(integer) to service_role;
