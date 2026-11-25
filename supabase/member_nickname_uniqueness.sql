-- Enforce unique member display names (nicknames), case-insensitively.
-- Safe to re-run. Existing duplicate nicknames are not silently rewritten.
create or replace function public.is_display_name_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and pg_catalog.char_length(pg_catalog.btrim(coalesce(candidate, ''))) between 2 and 20
    and not exists (
      select 1
      from public.user_profiles p
      where pg_catalog.lower(pg_catalog.btrim(coalesce(p.display_name, '')))
            = pg_catalog.lower(pg_catalog.btrim(coalesce(candidate, '')))
        and p.user_id <> auth.uid()
    );
$$;

revoke all on function public.is_display_name_available(text) from public, anon;
grant execute on function public.is_display_name_available(text) to authenticated;

create or replace function public.update_member_display_name(p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $1
  current_user_id uuid := auth.uid();
  normalized_name text := pg_catalog.btrim(coalesce(p_display_name, ''));
begin
  if current_user_id is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if pg_catalog.char_length(normalized_name) not between 2 and 20 then
    raise exception '닉네임은 2~20자로 입력해 주세요.';
  end if;
  if not public.is_display_name_available(normalized_name) then
    raise exception '이미 사용 중인 닉네임입니다.';
  end if;

  update public.user_profiles
  set display_name = normalized_name,
      updated_at = now()
  where user_id = current_user_id;

  if not found then
    raise exception '회원 프로필을 찾을 수 없습니다.';
  end if;
end;
$;

revoke all on function public.update_member_display_name(text) from public, anon;
grant execute on function public.update_member_display_name(text) to authenticated;

create or replace function public.enforce_unique_member_display_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := pg_catalog.lower(pg_catalog.btrim(coalesce(new.display_name, '')));
begin
  if normalized_name = '' then
    return new;
  end if;

  if pg_catalog.char_length(normalized_name) not between 2 and 20 then
    raise exception '닉네임은 2~20자로 입력해 주세요.';
  end if;

  -- Serialize writes for the same normalized nickname to prevent race conditions.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('balletmate-display-name:' || normalized_name, 0)
  );

  if exists (
    select 1
    from public.user_profiles p
    where pg_catalog.lower(pg_catalog.btrim(coalesce(p.display_name, ''))) = normalized_name
      and p.user_id <> new.user_id
  ) then
    raise exception '이미 사용 중인 닉네임입니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_unique_member_display_name on public.user_profiles;
create trigger enforce_unique_member_display_name
before insert or update of display_name on public.user_profiles
for each row
execute function public.enforce_unique_member_display_name();

revoke all on function public.enforce_unique_member_display_name() from public, anon, authenticated;
