-- Balletmate studio intake, provenance and bounded image-crawl queue.
-- Safe to re-run. Existing studio IDs and map data are preserved.

alter table public.studios
  add column if not exists source_url text,
  add column if not exists source_name text,
  add column if not exists verified_at timestamptz,
  add column if not exists image_urls text[] not null default '{}',
  add column if not exists image_source_name text,
  add column if not exists image_checked_at timestamptz,
  add column if not exists image_usage_note text;

create table if not exists public.studio_image_crawl_queue (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null unique references public.studios(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','done','failed')),
  attempts smallint not null default 0 check (attempts between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists studio_image_crawl_due_idx
  on public.studio_image_crawl_queue(status, next_attempt_at);

alter table public.studio_image_crawl_queue enable row level security;
grant select, insert, update, delete on public.studio_image_crawl_queue to authenticated;
drop policy if exists "admins manage studio image crawl queue" on public.studio_image_crawl_queue;
create policy "admins manage studio image crawl queue"
  on public.studio_image_crawl_queue
  for all to authenticated
  using (public.is_balletmate_admin())
  with check (public.is_balletmate_admin());

create or replace function public.enqueue_studio_image_crawl()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.website_url is not null and length(trim(new.website_url)) > 0
     and (tg_op = 'INSERT' or old.website_url is distinct from new.website_url) then
    insert into public.studio_image_crawl_queue(studio_id, status, attempts, next_attempt_at, last_error, updated_at)
    values (new.id, 'pending', 0, now(), null, now())
    on conflict (studio_id) do update
      set status = 'pending',
          attempts = 0,
          next_attempt_at = now(),
          last_error = null,
          updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists studios_enqueue_image_crawl on public.studios;
create trigger studios_enqueue_image_crawl
  after insert or update of website_url on public.studios
  for each row execute function public.enqueue_studio_image_crawl();

-- Queue existing studios with a website only when they have never been checked.
insert into public.studio_image_crawl_queue(studio_id)
select s.id
from public.studios s
where s.website_url is not null
  and length(trim(s.website_url)) > 0
  and s.image_checked_at is null
  and coalesce(array_length(s.image_urls, 1), 0) = 0
on conflict (studio_id) do nothing;

create or replace function public.claim_studio_image_crawl_queue(p_limit integer default 2)
returns table(id uuid, studio_id uuid, attempts smallint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_balletmate_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  return query
  with candidates as (
    select q.id
    from public.studio_image_crawl_queue q
    where q.status = 'pending'
      and q.next_attempt_at <= now()
      and q.attempts < 3
    order by q.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 1), 1), 2)
  )
  update public.studio_image_crawl_queue q
  set status = 'processing', updated_at = now()
  from candidates c
  where q.id = c.id
  returning q.id, q.studio_id, q.attempts;
end;
$$;

revoke all on function public.claim_studio_image_crawl_queue(integer) from public;
grant execute on function public.claim_studio_image_crawl_queue(integer) to authenticated;

-- Publicly readable studio image bucket; only Balletmate admins can upload/change/delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('studio-photos', 'studio-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = true,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "public can view studio photos" on storage.objects;
create policy "public can view studio photos"
  on storage.objects for select to public
  using (bucket_id = 'studio-photos');

drop policy if exists "admins upload studio photos" on storage.objects;
create policy "admins upload studio photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'studio-photos' and public.is_balletmate_admin());

drop policy if exists "admins update studio photos" on storage.objects;
create policy "admins update studio photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'studio-photos' and public.is_balletmate_admin())
  with check (bucket_id = 'studio-photos' and public.is_balletmate_admin());

drop policy if exists "admins delete studio photos" on storage.objects;
create policy "admins delete studio photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'studio-photos' and public.is_balletmate_admin());
