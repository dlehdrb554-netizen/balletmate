-- Community feed performance: aggregate engagement counts on the server.
-- Run once in Supabase SQL Editor after community.sql and community_engagement_and_comment_photos.sql.
-- Safe to re-run. SECURITY INVOKER preserves the existing table RLS policies.

create or replace function public.get_community_post_metrics(p_post_ids uuid[])
returns table (
  post_id uuid,
  likes_count bigint,
  comments_count bigint,
  liked_by_me boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id as post_id,
    (
      select count(*)::bigint
      from public.community_post_likes l
      where l.post_id = p.id
    ) as likes_count,
    (
      select count(*)::bigint
      from public.community_comments c
      where c.post_id = p.id
    ) as comments_count,
    exists (
      select 1
      from public.community_post_likes l
      where l.post_id = p.id
        and l.user_id = auth.uid()
    ) as liked_by_me
  from public.community_posts p
  where p.id = any(coalesce(p_post_ids, '{}'::uuid[]));
$$;

revoke all on function public.get_community_post_metrics(uuid[]) from public;
grant execute on function public.get_community_post_metrics(uuid[]) to anon, authenticated;

notify pgrst, 'reload schema';
