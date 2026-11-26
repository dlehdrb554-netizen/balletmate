-- Limit member nickname changes to once every 24 hours.
-- Run this migration once in Supabase SQL Editor. Safe to re-run.

alter table public.user_profiles
  add column if not exists display_name_changed_at timestamptz;

create or replace function public.enforce_daily_member_display_name_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
begin
  if old.display_name is distinct from new.display_name then
    v_now := pg_catalog.clock_timestamp();

    if old.display_name_changed_at is not null
       and old.display_name_changed_at > v_now - interval '24 hours' then
      raise exception using
        errcode = 'P0001',
        message = '닉네임은 변경 후 24시간이 지나야 다시 변경할 수 있습니다.';
    end if;

    new.display_name_changed_at := v_now;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_daily_member_display_name_change() from public, anon, authenticated;

drop trigger if exists enforce_daily_member_display_name_change on public.user_profiles;
create trigger enforce_daily_member_display_name_change
before update of display_name on public.user_profiles
for each row
execute function public.enforce_daily_member_display_name_change();

create or replace function public.update_member_display_name(p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
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
      updated_at = pg_catalog.now()
  where user_id = current_user_id;

  if not found then
    raise exception '회원 프로필을 찾을 수 없습니다.';
  end if;
end;
$$;

revoke all on function public.update_member_display_name(text) from public, anon;
grant execute on function public.update_member_display_name(text) to authenticated;

notify pgrst, 'reload schema';
