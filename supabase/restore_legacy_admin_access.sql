-- Restore administrator access for legacy accounts whose trusted profile flag is already set.
-- Safe to re-run. Does not modify auth identities, passwords, or member profile data.
insert into public.admin_users(user_id)
select p.user_id
from public.user_profiles p
where p.is_admin is true
on conflict (user_id) do nothing;

create or replace function public.is_balletmate_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.admin_users a where a.user_id = auth.uid())
    or exists (select 1 from public.user_profiles p where p.user_id = auth.uid() and p.is_admin is true);
$$;

revoke all on function public.is_balletmate_admin() from public;
grant execute on function public.is_balletmate_admin() to anon, authenticated;
