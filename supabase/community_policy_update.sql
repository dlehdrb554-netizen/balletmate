-- Community policy v2: new consent version and consistent moderation notices.
-- Run in Supabase SQL Editor after community_safety.sql and push_notifications_and_app_notices.sql.
-- Re-runnable.

create or replace function public.require_community_terms_acceptance()
returns trigger
language plpgsql
security definer
set search_path = public
as $require_terms$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.community_terms_acceptances
    where user_id = auth.uid()
      and terms_version = '2026-11-27-community-policy-1'
  ) then
    raise exception using
      errcode = '42501',
      message = '커뮤니티 운영정책 동의가 필요합니다. 커뮤니티에서 최신 운영정책을 확인해 주세요.';
  end if;
  return new;
end;
$require_terms$;

revoke all on function public.require_community_terms_acceptance() from public, anon, authenticated;

-- Add a dedicated report reason so copyright/portrait reports map to policy clause 4.
alter table public.community_reports
  drop constraint if exists community_reports_reason_check;
alter table public.community_reports
  add constraint community_reports_reason_check
  check (reason in ('스팸/광고','욕설/괴롭힘','부적절한 콘텐츠','개인정보 노출','허위 정보','기타','저작권·초상권 침해'));

-- When an admin removes reported content, notify its author using the same
-- numbered policy terms shown in app/community-policy.tsx.
create or replace function public.admin_remove_community_content(
  p_content_type text,
  p_content_id uuid,
  p_report_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $remove_content$
declare
  v_author_id uuid;
  v_reason text;
  v_policy_clause text;
  v_content_label text;
  v_deleted boolean := false;
begin
  if not public.is_balletmate_admin() then
    raise exception 'Admin access required';
  end if;

  select reason into v_reason
  from public.community_reports
  where id = p_report_id;

  if p_content_type = 'post' then
    select author_id into v_author_id
    from public.community_posts
    where id = p_content_id;
    delete from public.community_posts where id = p_content_id;
    v_deleted := found;
    v_content_label := '게시글';
  elsif p_content_type = 'comment' then
    select author_id into v_author_id
    from public.community_comments
    where id = p_content_id;
    delete from public.community_comments where id = p_content_id;
    v_deleted := found;
    v_content_label := '댓글';
  else
    raise exception 'Invalid content type';
  end if;

  if not v_deleted then
    return false;
  end if;

  v_policy_clause := case v_reason
    when '스팸/광고' then '제2항(광고·홍보 및 도배)'
    when '욕설/괴롭힘' then '제1항(상호 존중)'
    when '개인정보 노출' then '제3항(개인정보 보호)'
    when '저작권·초상권 침해' then '제4항(저작권·초상권 및 권리 보호)'
    when '부적절한 콘텐츠' then '제5항(허위 정보 및 부적절한 콘텐츠)'
    when '허위 정보' then '제5항(허위 정보 및 부적절한 콘텐츠)'
    else '커뮤니티 운영정책'
  end;

  update public.community_reports
  set status = 'actioned',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      admin_note = '작성 기준 ' || v_policy_clause || ' 위반으로 ' || v_content_label || ' 삭제'
  where id = p_report_id;

  if v_author_id is not null
     and to_regprocedure('public.dispatch_balletmate_push(jsonb)') is not null then
    execute 'select public.dispatch_balletmate_push($1)'
    using jsonb_build_object(
      'scope', 'users',
      'user_ids', jsonb_build_array(v_author_id),
      'preference', 'announcements',
      'title', '커뮤니티 콘텐츠 조치 안내',
      'body', '작성 기준 ' || v_policy_clause || ' 위반으로 ' || v_content_label || '이 삭제되었습니다. 운영정책 전체보기에서 기준을 확인할 수 있습니다.',
      'data', jsonb_build_object(
        'kind', 'community_moderation',
        'contentType', p_content_type,
        'contentId', p_content_id,
        'reportId', p_report_id,
        'policyClause', v_policy_clause
      )
    );
  end if;

  return true;
end;
$remove_content$;

revoke all on function public.admin_remove_community_content(text,uuid,bigint) from public, anon;
grant execute on function public.admin_remove_community_content(text,uuid,bigint) to authenticated;
