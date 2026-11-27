-- Community engagement and comment photo support.
-- Run once in Supabase SQL Editor. Safe to re-run.

alter table public.community_comments
  add column if not exists image_urls text[] not null default '{}';

create table if not exists public.community_post_likes (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists community_post_likes_post_idx
  on public.community_post_likes(post_id);

alter table public.community_post_likes enable row level security;
revoke all on public.community_post_likes from public;
grant select on public.community_post_likes to anon, authenticated;
grant insert, delete on public.community_post_likes to authenticated;

drop policy if exists "Community likes are public" on public.community_post_likes;
create policy "Community likes are public"
  on public.community_post_likes for select to anon, authenticated
  using (true);

drop policy if exists "Members like posts" on public.community_post_likes;
create policy "Members like posts"
  on public.community_post_likes for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.community_posts p where p.id = post_id)
  );

drop policy if exists "Members unlike own likes" on public.community_post_likes;
create policy "Members unlike own likes"
  on public.community_post_likes for delete to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';
