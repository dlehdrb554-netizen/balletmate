-- Pause discovery jobs and protect deleted studios from automatic re-insertion.
-- This migration intentionally does NOT replace register_discovered_studio().

begin;

create table if not exists public.studio_discovery_exclusions (
  id bigint generated always as identity primary key,
  studio_id uuid,
  studio_name text not null,
  normalized_name text not null,
  source_url text,
  latitude double precision,
  longitude double precision,
  reason text not null default 'studio_deleted',
  deleted_by uuid,
  deleted_at timestamptz not null default now(),
  is_active boolean not null default true
);

create index if not exists studio_discovery_exclusions_active_url_idx
  on public.studio_discovery_exclusions (source_url)
  where is_active and source_url is not null;

create index if not exists studio_discovery_exclusions_active_name_idx
  on public.studio_discovery_exclusions (normalized_name)
  where is_active;

-- Capture future physical deletions.
create or replace function public.capture_studio_discovery_exclusion()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into public.studio_discovery_exclusions
    (studio_id, studio_name, normalized_name, source_url, latitude, longitude, reason, deleted_by)
  values
    (
      old.id,
      old.name,
      lower(regexp_replace(trim(old.name), '[^a-z0-9가-힣]', '', 'g')),
      nullif(regexp_replace(trim(coalesce(old.source_url, '')), '/+$', ''), ''),
      old.latitude,
      old.longitude,
      'studio_deleted',
      auth.uid()
    );
  return old;
end;
$function$;

drop trigger if exists studios_capture_discovery_exclusion on public.studios;
create trigger studios_capture_discovery_exclusion
before delete on public.studios
for each row execute function public.capture_studio_discovery_exclusion();

-- Block matching future inserts without modifying the existing discovery RPC.
create or replace function public.block_excluded_studio_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  candidate_name text;
  candidate_url text;
begin
  candidate_name := lower(regexp_replace(trim(coalesce(new.name, '')), '[^a-z0-9가-힣]', '', 'g'));
  candidate_url := nullif(regexp_replace(trim(coalesce(new.source_url, '')), '/+$', ''), '');

  if exists (
    select 1
    from public.studio_discovery_exclusions e
    where e.is_active
      and (
        (candidate_url is not null and e.source_url = candidate_url)
        or (
          candidate_name <> ''
          and e.normalized_name = candidate_name
          and e.latitude is not null
          and e.longitude is not null
          and new.latitude is not null
          and new.longitude is not null
          and sqrt(
            power((e.latitude - new.latitude) * 111.0, 2)
            + power((e.longitude - new.longitude) * 111.0 * cos(radians(new.latitude)), 2)
          ) <= 0.035
        )
      )
  ) then
    return null;
  end if;

  return new;
end;
$function$;

drop trigger if exists studios_block_excluded_insert on public.studios;
create trigger studios_block_excluded_insert
before insert on public.studios
for each row execute function public.block_excluded_studio_insert();

-- Pause scheduled discovery and verification jobs.
select cron.unschedule(jobid)
from cron.job
where jobname in (
  'balletmate-kakao-studio-discovery',
  'balletmate-neis-academy-discovery',
  'balletmate-neis-kakao-verification'
);

commit;
