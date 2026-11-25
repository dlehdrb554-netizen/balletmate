-- Required member identity for social and email/password registrations.
alter table public.user_profiles add column if not exists display_name text;

create or replace function public.complete_member_profile(p_username text,p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  normalized_username text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_username,'')));
  normalized_display text := pg_catalog.btrim(coalesce(p_display_name,''));
begin
  if uid is null then raise exception '로그인이 필요합니다.'; end if;
  if normalized_username !~ '^[a-z0-9_]{3,24}$' or pg_catalog.left(normalized_username,7)='social_' then
    raise exception '계정은 영문 소문자, 숫자, 밑줄로 3~24자 입력해 주세요.';
  end if;
  if pg_catalog.char_length(normalized_display)<2 or pg_catalog.char_length(normalized_display)>20 then
    raise exception '닉네임은 2~20자로 입력해 주세요.';
  end if;
  update public.user_profiles
  set username=normalized_username,display_name=normalized_display,updated_at=now()
  where user_id=uid;
  if not found then raise exception '회원 프로필을 찾을 수 없습니다.'; end if;
end;
$$;
revoke all on function public.complete_member_profile(text,text) from public,anon;
grant execute on function public.complete_member_profile(text,text) to authenticated;

create or replace function public.sync_username_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uname text;
  profile_name text;
begin
  uname := pg_catalog.lower(coalesce(new.raw_user_meta_data ->> 'username',''));
  profile_name := pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'display_name',''));
  if uname !~ '^[a-z0-9_]{3,24}$' then
    uname := 'social_' || pg_catalog.substr(pg_catalog.replace(new.id::text,'-',''),1,12);
  end if;
  if profile_name='' then profile_name:=null; end if;
  if profile_name is null and pg_catalog.left(uname,7)='social_' then
    profile_name:=public.generate_member_display_name();
  end if;
  insert into public.user_profiles as existing(user_id,username,display_name,phone_number,phone_verified_at,updated_at)
  values(new.id,uname,profile_name,case when new.phone_confirmed_at is not null then new.phone else null end,new.phone_confirmed_at,now())
  on conflict(user_id) do update set
    username=case when pg_catalog.left(existing.username,7)='social_' and pg_catalog.left(excluded.username,7)<>'social_' then excluded.username else existing.username end,
    display_name=coalesce(nullif(existing.display_name,''),excluded.display_name),
    phone_number=excluded.phone_number,
    phone_verified_at=excluded.phone_verified_at,
    updated_at=now();
  return new;
end;
$$;

create table if not exists public.user_notification_preferences(
 user_id uuid primary key references auth.users(id) on delete cascade,
 preferences jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);
alter table public.user_notification_preferences enable row level security;
grant select,insert,update on public.user_notification_preferences to authenticated;
drop policy if exists "members manage own notification preferences" on public.user_notification_preferences;
create policy "members manage own notification preferences" on public.user_notification_preferences
 for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
