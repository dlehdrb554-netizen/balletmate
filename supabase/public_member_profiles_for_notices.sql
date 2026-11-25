-- 학원 공지 작성자의 공개 프로필 일부만 반환합니다. 이메일·전화번호 등 비공개 정보는 노출하지 않습니다.
create or replace function public.get_public_member_profiles(p_user_ids uuid[])
returns table(user_id uuid, display_name text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id,
         coalesce(nullif(p.display_name, ''), nullif(p.username, ''), '회원') as display_name,
         p.avatar_url
  from public.user_profiles p
  where p.user_id = any(coalesce(p_user_ids, '{}'::uuid[]));
$$;

revoke all on function public.get_public_member_profiles(uuid[]) from public;
grant execute on function public.get_public_member_profiles(uuid[]) to anon, authenticated;
