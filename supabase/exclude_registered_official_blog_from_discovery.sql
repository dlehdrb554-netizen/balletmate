-- Exclude studios that already have an active official Naver blog from discovery.
-- Safe to run after studio_blog_search.sql.

create or replace function public.enqueue_studio_blog_search_for_active_studio()
returns trigger
language plpgsql
security definer
set search_path = public
as $trigger$
begin
  if coalesce(new.is_active, true)
     and (tg_op = 'INSERT' or old.is_active is distinct from new.is_active)
     and not exists (
       select 1 from public.studio_blog_official_accounts a
       where a.studio_id = new.id and a.is_active = true
     ) then
    insert into public.studio_blog_search_queue(studio_id,status,attempts,last_error,updated_at)
    values(new.id,'pending',0,null,now())
    on conflict(studio_id) do update
      set status='pending',attempts=0,last_error=null,updated_at=now();
  end if;
  return new;
end;
$trigger$;

create or replace function public.claim_studio_blog_search_jobs(p_limit integer default 3)
returns table(studio_id uuid, studio_name text, attempts integer)
language plpgsql
security definer
set search_path = public
as $claim$
begin
  -- Drain stale queue entries for academies that now have an official blog.
  update public.studio_blog_search_queue q
     set status='completed', last_error=null, updated_at=now()
   where (q.status='pending' or (q.status='processing' and q.updated_at < now() - interval '20 minutes'))
     and exists (
       select 1 from public.studio_blog_official_accounts a
       where a.studio_id=q.studio_id and a.is_active=true
     );

  return query
  with picked as (
    select q.studio_id
      from public.studio_blog_search_queue q
     where (q.status='pending' or (q.status='processing' and q.updated_at < now() - interval '20 minutes'))
       and not exists (
         select 1 from public.studio_blog_official_accounts a
         where a.studio_id=q.studio_id and a.is_active=true
       )
     order by q.updated_at asc
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 3), 5))
  ), claimed as (
    update public.studio_blog_search_queue q
       set status='processing', attempts=q.attempts+1, updated_at=now()
      from picked p
     where q.studio_id=p.studio_id
    returning q.studio_id,q.attempts
  )
  select c.studio_id,s.name,c.attempts
    from claimed c join public.studios s on s.id=c.studio_id;
end;
$claim$;

-- Existing queued records are immediately excluded; records remain for audit/history.
update public.studio_blog_search_queue q
   set status='completed',last_error=null,updated_at=now()
 where q.status in ('pending','processing')
   and exists (
     select 1 from public.studio_blog_official_accounts a
     where a.studio_id=q.studio_id and a.is_active=true
   );

revoke all on function public.claim_studio_blog_search_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_studio_blog_search_jobs(integer) to service_role;
