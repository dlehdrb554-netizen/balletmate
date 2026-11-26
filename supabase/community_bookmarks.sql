-- Community post bookmarks
create table if not exists public.community_post_bookmarks(
 user_id uuid not null references auth.users(id) on delete cascade,
 post_id uuid not null references public.community_posts(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(user_id,post_id)
);
alter table public.community_post_bookmarks enable row level security;
revoke all on public.community_post_bookmarks from public,anon;
grant select,insert,delete on public.community_post_bookmarks to authenticated;
drop policy if exists "Members read own community bookmarks" on public.community_post_bookmarks;
create policy "Members read own community bookmarks" on public.community_post_bookmarks for select to authenticated using(user_id=auth.uid());
drop policy if exists "Members save own community bookmarks" on public.community_post_bookmarks;
create policy "Members save own community bookmarks" on public.community_post_bookmarks for insert to authenticated with check(user_id=auth.uid() and exists(select 1 from public.community_posts p where p.id=post_id));
drop policy if exists "Members remove own community bookmarks" on public.community_post_bookmarks;
create policy "Members remove own community bookmarks" on public.community_post_bookmarks for delete to authenticated using(user_id=auth.uid());

-- Refresh PostgREST schema cache so the new table is immediately discoverable.
notify pgrst, 'reload schema';
