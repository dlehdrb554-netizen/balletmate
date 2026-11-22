-- Social login profile display names.
-- Run once in Supabase SQL Editor. Internal usernames remain private and unchanged.
alter table public.user_profiles
  add column if not exists display_name text;

create or replace function public.generate_member_display_name()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select
    (array['우아한','포근한','반짝이는','씩씩한','산뜻한','다정한','즐거운','차분한','빛나는','사랑스러운'])
      [1 + floor(random() * 10)::int]
    ||
    (array['발레리나','발레꿈나무','토슈즈','백조','무용수','발레메이트','연습생','발레친구','리틀스완','발레요정'])
      [1 + floor(random() * 10)::int];
$$;

revoke all on function public.generate_member_display_name() from public, anon, authenticated;

-- Existing social accounts get a private, randomly generated display name.
update public.user_profiles
set display_name = public.generate_member_display_name(),
    updated_at = now()
where username like 'social\_%' escape '\'
  and nullif(trim(display_name), '') is null;

create or replace function public.sync_username_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uname text;
  generated_display_name text;
begin
  uname := pg_catalog.lower(COALESCE(new.raw_user_meta_data ->> 'username', ''));

  if uname !~ '^[a-z0-9_]{3,24}$' then
    uname := 'social_' || pg_catalog.substr(pg_catalog.replace(new.id::text, '-', ''), 1, 12);
  end if;

  if pg_catalog.left(uname, 7) = 'social_' then
    generated_display_name := public.generate_member_display_name();
  else
    generated_display_name := null;
  end if;

  insert into public.user_profiles as existing (
    user_id, username, display_name, phone_number, phone_verified_at, updated_at
  )
  values (
    new.id,
    uname,
    generated_display_name,
    case when new.phone_confirmed_at is not null then new.phone else null end,
    new.phone_confirmed_at,
    now()
  )
  on conflict (user_id) do update set
    username = case
      when existing.username ~ '^[a-z0-9_]{3,24}$'
        and pg_catalog.left(existing.username, 7) <> 'social_'
      then existing.username
      else excluded.username
    end,
    display_name = COALESCE(NULLIF(existing.display_name, ''), excluded.display_name),
    phone_number = excluded.phone_number,
    phone_verified_at = excluded.phone_verified_at,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists sync_username_profile_auth on auth.users;
drop trigger if exists sync_username_profile_auth_update on auth.users;

create trigger sync_username_profile_auth
  after insert on auth.users
  for each row execute function public.sync_username_profile();

create trigger sync_username_profile_auth_update
  after update of raw_user_meta_data, phone, phone_confirmed_at on auth.users
  for each row execute function public.sync_username_profile();

comment on function public.sync_username_profile() is
  'Keeps internal usernames private and assigns a generated display name to social-login accounts.';
