-- Pause automated discovery and prevent deleted studios from being re-created.
-- Run this once in Supabase SQL Editor before re-enabling any scheduled worker.

begin;

create table if not exists public.studio_discovery_exclusions (
 id bigint generated always as identity primary key,
 studio_id uuid,
 studio_name text not null,
 normalized_name text not null,
 source_url text,
 latitude double precision,
 longitude double precision,
 reason text not null default 'admin_deleted',
 deleted_by uuid,
 deleted_at timestamptz not null default now(),
 is_active boolean not null default true
);
create index if not exists studio_discovery_exclusions_active_name_idx
 on public.studio_discovery_exclusions(normalized_name) where is_active=true;
create index if not exists studio_discovery_exclusions_active_url_idx
 on public.studio_discovery_exclusions(source_url) where is_active=true and source_url is not null;
alter table public.studio_discovery_exclusions enable row level security;
grant select,update on public.studio_discovery_exclusions to authenticated;
drop policy if exists "admins view discovery exclusions" on public.studio_discovery_exclusions;
create policy "admins view discovery exclusions" on public.studio_discovery_exclusions
 for select to authenticated using (public.is_balletmate_admin());
drop policy if exists "admins manage discovery exclusions" on public.studio_discovery_exclusions;
create policy "admins manage discovery exclusions" on public.studio_discovery_exclusions
 for update to authenticated using (public.is_balletmate_admin()) with check (public.is_balletmate_admin());

create or replace function public.capture_studio_discovery_exclusion()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.studio_discovery_exclusions
  (studio_id,studio_name,normalized_name,source_url,latitude,longitude,reason,deleted_by)
 values
  (old.id,old.name,lower(regexp_replace(trim(old.name),'[^a-z0-9가-힣]','','g')),
   nullif(regexp_replace(trim(coalesce(old.source_url,'')),'/+$',''),''),
   old.latitude,old.longitude,'studio_deleted',auth.uid());
 return old;
end $$;
drop trigger if exists studios_capture_discovery_exclusion on public.studios;
create trigger studios_capture_discovery_exclusion
 before delete on public.studios
 for each row execute function public.capture_studio_discovery_exclusion();

-- Backfill complete snapshots from the existing unrelated-studio cleanup archive.
do $$
begin
 if to_regclass('public.studio_unrelated_deletion_audit') is not null then
  execute $q$
   insert into public.studio_discovery_exclusions
    (studio_id,studio_name,normalized_name,source_url,latitude,longitude,reason,deleted_at,deleted_by)
   select a.studio_id,a.studio_name,
    lower(regexp_replace(trim(a.studio_name),'[^a-z0-9가-힣]','','g')),
    nullif(regexp_replace(trim(coalesce(a.studio_snapshot->>'source_url','')),'/+$',''),''),
    nullif(a.studio_snapshot->>'latitude','')::double precision,
    nullif(a.studio_snapshot->>'longitude','')::double precision,
    'backfilled_cleanup_archive',a.deleted_at,a.deleted_by
   from public.studio_unrelated_deletion_audit a
   where not exists (
    select 1 from public.studio_discovery_exclusions e
    where e.studio_id=a.studio_id and e.reason='backfilled_cleanup_archive'
   )
  $q$;
 end if;
end $$;

create or replace function public.register_discovered_studio(
 p_name text,p_latitude double precision,p_longitude double precision,
 p_address text,p_phone text,p_place_url text,p_region text
)
returns table(inserted boolean,studio_id uuid)
language plpgsql security definer set search_path=public as $$
declare new_id uuid; normalized_name text; normalized_phone text; normalized_url text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
 if p_name is null or length(trim(p_name))<2 or p_latitude is null or p_longitude is null
    or p_latitude not between 33 and 39 or p_longitude not between 124 and 132 then
  return query select false,null::uuid; return;
 end if;
 if (p_name ~* '(댄스[[:space:]]*스튜디오|댄스[[:space:]]*스포츠|폴[[:space:]]*댄스|(밸리|벨리)[[:space:]]*댄스|dance[[:space:]]*studio|dance[[:space:]]*sports|pole[[:space:]]*dance|belly[[:space:]]*dance)') then
  return query select false,null::uuid; return;
 end if;
 normalized_name:=lower(regexp_replace(trim(p_name),'[^a-z0-9가-힣]','','g'));
 normalized_phone:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 normalized_url:=nullif(regexp_replace(trim(coalesce(p_place_url,'')),'/+$',''),'');
 -- Block previously deleted studios before attempting any match or insert.
 if exists (
  select 1 from public.studio_discovery_exclusions e
  where e.is_active=true and (
   (normalized_url is not null and e.source_url=normalized_url)
   or (e.normalized_name=normalized_name and e.latitude is not null and e.longitude is not null
    and sqrt(power((e.latitude-p_latitude)*111.0,2)+power((e.longitude-p_longitude)*111.0*cos(radians(p_latitude)),2))<=0.035)
  )
 ) then
  return query select false,null::uuid; return;
 end if;
 if normalized_url is not null then
  select s.id into new_id from public.studios s
  where regexp_replace(trim(coalesce(s.source_url,'')),'/+$','')=normalized_url
  order by s.created_at asc limit 1;
 end if;
 if new_id is null then
  select s.id into new_id from public.studios s
  where nullif(regexp_replace(trim(coalesce(s.address,'')),'[^a-z0-9가-힣]','','g'),'') is not null
    and nullif(regexp_replace(trim(coalesce(p_address,'')),'[^a-z0-9가-힣]','','g'),'') is not null
    and lower(regexp_replace(trim(s.address),'[^a-z0-9가-힣]','','g'))=lower(regexp_replace(trim(p_address),'[^a-z0-9가-힣]','','g'))
    and sqrt(power((s.latitude-p_latitude)*111.0,2)+power((s.longitude-p_longitude)*111.0*cos(radians(p_latitude)),2))<=0.10
    and (lower(regexp_replace(trim(s.name),'[^a-z0-9가-힣]','','g'))=normalized_name
      or (normalized_phone<>'' and regexp_replace(coalesce(s.phone,''),'[^0-9]','','g')=normalized_phone))
  order by s.created_at asc limit 1;
 end if;
 if new_id is null then
  select s.id into new_id from public.studios s
  where normalized_name<>'' and lower(regexp_replace(trim(s.name),'[^a-z0-9가-힣]','','g'))=normalized_name
    and (nullif(trim(coalesce(s.address,'')),'') is null or nullif(trim(coalesce(p_address,'')),'') is null)
    and sqrt(power((s.latitude-p_latitude)*111.0,2)+power((s.longitude-p_longitude)*111.0*cos(radians(p_latitude)),2))<=0.035
  order by s.created_at asc limit 1;
 end if;
 if new_id is not null then return query select false,new_id; return; end if;
 insert into public.studios(name,latitude,longitude,district,address,phone,source_url,source_name,verified_at,is_active,adult_classes,kids_classes,updated_at)
 values(trim(p_name),p_latitude,p_longitude,p_region,p_address,nullif(trim(coalesce(p_phone,'')),''),normalized_url,
  'Kakao Local Search 자동 발견',now(),true,false,false,now()) returning id into new_id;
 return query select true,new_id;
end $$;
revoke all on function public.register_discovered_studio(text,double precision,double precision,text,text,text,text) from public;
grant execute on function public.register_discovered_studio(text,double precision,double precision,text,text,text,text) to service_role;

-- Stop all three scheduled ingestion/verification jobs immediately.
select cron.unschedule(jobid)
from cron.job
where jobname in (
 'balletmate-kakao-studio-discovery',
 'balletmate-neis-academy-discovery',
 'balletmate-neis-kakao-verification'
);

commit;
