-- Administrator status is managed only through public.admin_users.
-- This function does not infer privileges from member profile fields.
-- It is safe to re-run and does not create or modify administrator assignments.
create or replace function public.is_balletmate_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_balletmate_admin() from public;
grant execute on function public.is_balletmate_admin() to anon, authenticated;
