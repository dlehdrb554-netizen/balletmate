-- Optional username-based member accounts. Safe to run repeatedly.
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_profiles enable row level security;
grant select on public.user_profiles to authenticated;
drop policy if exists "users view own profile" on public.user_profiles;
create policy "users view own profile" on public.user_profiles
for select to authenticated using (user_id = auth.uid());

-- Create profile automatically during Auth signup to avoid orphaned auth accounts.
create or replace function public.create_username_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare uname text;
begin
  uname := lower(coalesce(new.raw_user_meta_data->>'username',''));
  if uname !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Username must be 3-24 lowercase letters, numbers, or underscores';
  end if;
  insert into public.user_profiles(user_id, username)
  values (new.id, uname);
  return new;
end;
$$;
drop trigger if exists create_username_profile_on_signup on auth.users;
create trigger create_username_profile_on_signup
after insert on auth.users
for each row execute function public.create_username_profile();

-- Optional favorites sync, separate from the public studio catalog.
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
