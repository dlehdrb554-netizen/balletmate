-- Create a private profile row for OAuth users who do not have a legacy username.
-- Run after supabase/optional_accounts.sql and supabase/social_display_names.sql.
-- Existing usernames and account IDs are preserved.
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
  'Keeps legacy username accounts and creates a generated private username and display name for Google/Kakao OAuth accounts.';
