-- Optional username-based member accounts. Safe to run once (or re-run).
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_profiles enable row level security;
grant select, insert, update on public.user_profiles to authenticated;
drop policy if exists "users view own profile" on public.user_profiles;
create policy "users view own profile" on public.user_profiles
for select to authenticated using (user_id = auth.uid());
drop policy if exists "users insert own profile" on public.user_profiles;
create policy "users insert own profile" on public.user_profiles
for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "users update own profile" on public.user_profiles;
create policy "users update own profile" on public.user_profiles
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
