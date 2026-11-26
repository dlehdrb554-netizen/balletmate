-- Apply each member's blocked-user filter inside PostgreSQL RLS.
-- This removes the need to send a potentially large blocked-user ID list
-- in PostgREST query URLs. Run once in Supabase SQL Editor.
-- Safe to re-run.

drop policy if exists "community posts are public" on public.community_posts;
create policy "community posts are public"
  on public.community_posts
  for select to anon, authenticated
  using (
    auth.uid() is null
    or not exists (
      select 1
      from public.community_user_blocks b
      where b.blocker_id = auth.uid()
        and b.blocked_user_id = community_posts.author_id
    )
  );

drop policy if exists "community comments are public" on public.community_comments;
create policy "community comments are public"
  on public.community_comments
  for select to anon, authenticated
  using (
    auth.uid() is null
    or not exists (
      select 1
      from public.community_user_blocks b
      where b.blocker_id = auth.uid()
        and b.blocked_user_id = community_comments.author_id
    )
  );
