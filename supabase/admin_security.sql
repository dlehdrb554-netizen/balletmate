-- Balletmate administrator access controls (safe to re-run).
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
drop policy if exists "admins can view own admin record" on public.admin_users;
create policy "admins can view own admin record" on public.admin_users
for select to authenticated using (user_id = auth.uid());

create or replace function public.is_balletmate_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;
revoke all on function public.is_balletmate_admin() from public;
grant execute on function public.is_balletmate_admin() to anon, authenticated;

-- Admins only may create, edit, delete data. Public read policies remain active-only.
grant insert, update, delete on public.studios, public.classes, public.class_sessions, public.coupons to authenticated;

drop policy if exists "admins manage studios" on public.studios;
create policy "admins manage studios" on public.studios
for all to authenticated using (public.is_balletmate_admin()) with check (public.is_balletmate_admin());

drop policy if exists "admins manage classes" on public.classes;
create policy "admins manage classes" on public.classes
for all to authenticated using (public.is_balletmate_admin()) with check (public.is_balletmate_admin());

drop policy if exists "admins manage sessions" on public.class_sessions;
create policy "admins manage sessions" on public.class_sessions
for all to authenticated using (public.is_balletmate_admin()) with check (public.is_balletmate_admin());

drop policy if exists "admins manage coupons" on public.coupons;
create policy "admins manage coupons" on public.coupons
for all to authenticated using (public.is_balletmate_admin()) with check (public.is_balletmate_admin());
