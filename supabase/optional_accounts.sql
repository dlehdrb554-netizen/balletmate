-- Optional username accounts, SMS phone verification, and private favorites.
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  phone_number text unique,
  phone_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_profiles enable row level security;
grant select on public.user_profiles to authenticated;
drop policy if exists "users view own profile" on public.user_profiles;
create policy "users view own profile" on public.user_profiles
for select to authenticated using (user_id = auth.uid());

-- Public RPC returns only whether a specific username is available.
create or replace function public.is_username_available(candidate text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select lower(coalesce(candidate,'')) ~ '^[a-z0-9_]{3,24}
$$;
revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;

-- Insert/update profile from Auth metadata after phone OTP verification and credential setup.
create or replace function public.sync_username_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare uname text;
begin
  uname := lower(coalesce(new.raw_user_meta_data->>'username',''));
  if uname !~ '^[a-z0-9_]{3,24}$' then
    return new;
  end if;
  insert into public.user_profiles(user_id,username,phone_number,phone_verified_at,updated_at)
  values(new.id,uname,
    case when new.phone_confirmed_at is not null then new.phone else null end,
    new.phone_confirmed_at,now())
  on conflict (user_id) do update set
    username=excluded.username,
    phone_number=excluded.phone_number,
    phone_verified_at=excluded.phone_verified_at,
    updated_at=now();
  return new;
end;
$$;
drop trigger if exists sync_username_profile_auth on auth.users;
create trigger sync_username_profile_auth
after insert or update of raw_user_meta_data, phone, phone_confirmed_at on auth.users
for each row execute function public.sync_username_profile();

-- Private favorite snapshots for logged-in members.
create table if not exists public.user_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  studio_id text not null,
  studio_snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, studio_id)
);
alter table public.user_favorites enable row level security;
grant select, insert, update, delete on public.user_favorites to authenticated;
drop policy if exists "users manage own favorites" on public.user_favorites;
create policy "users manage own favorites" on public.user_favorites
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

    and not exists(select 1 from public.user_profiles p where p.username=lower(candidate))
    and not exists(select 1 from auth.users u where lower(coalesce(u.email,''))=lower(candidate)||'@balletmate.app');
$$;
revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;

-- Insert/update profile from Auth metadata after phone OTP verification and credential setup.
create or replace function public.sync_username_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare uname text;
begin
  uname := lower(coalesce(new.raw_user_meta_data->>'username',''));
  if uname !~ '^[a-z0-9_]{3,24}$' then
    return new;
  end if;
  insert into public.user_profiles(user_id,username,phone_number,phone_verified_at,updated_at)
  values(new.id,uname,
    case when new.phone_confirmed_at is not null then new.phone else null end,
    new.phone_confirmed_at,now())
  on conflict (user_id) do update set
    username=excluded.username,
    phone_number=excluded.phone_number,
    phone_verified_at=excluded.phone_verified_at,
    updated_at=now();
  return new;
end;
$$;
drop trigger if exists sync_username_profile_auth on auth.users;
create trigger sync_username_profile_auth
after insert or update of raw_user_meta_data, phone, phone_confirmed_at on auth.users
for each row execute function public.sync_username_profile();

-- Private favorite snapshots for logged-in members.
create table if not exists public.user_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  studio_id text not null,
  studio_snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, studio_id)
);
alter table public.user_favorites enable row level security;
grant select, insert, update, delete on public.user_favorites to authenticated;
drop policy if exists "users manage own favorites" on public.user_favorites;
create policy "users manage own favorites" on public.user_favorites
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
