-- Balletmate community: public reading, authenticated posting, server-enforced 30s cooldown.
-- Safe to re-run. Run this file once in Supabase SQL Editor.

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  category text not null check (category in ('학원 추천','발레복 추천','자유')),
  title text not null check (char_length(trim(title)) between 2 and 80),
  content text not null check (char_length(trim(content)) between 2 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  content text not null check (char_length(trim(content)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists community_posts_created_idx on public.community_posts(created_at desc);
create index if not exists community_posts_category_created_idx on public.community_posts(category, created_at desc);
create index if not exists community_comments_post_created_idx on public.community_comments(post_id, created_at asc);
create index if not exists community_posts_author_created_idx on public.community_posts(author_id, created_at desc);
create index if not exists community_comments_author_created_idx on public.community_comments(author_id, created_at desc);

-- Persistent cooldown ledger: deleting a post/comment must not reset the 30s limit.
create table if not exists public.community_submission_limits (
  author_id uuid primary key references auth.users(id) on delete cascade,
  last_submitted_at timestamptz not null
);

alter table public.community_submission_limits enable row level security;
revoke all on public.community_submission_limits from public, anon, authenticated;

-- Preserve the latest submission time when upgrading from the first migration.
insert into public.community_submission_limits (author_id, last_submitted_at)
select author_id, max(created_at)
from (
  select author_id, created_at from public.community_posts
  union all
  select author_id, created_at from public.community_comments
) submissions
group by author_id
on conflict (author_id) do update
set last_submitted_at = greatest(
  public.community_submission_limits.last_submitted_at,
  excluded.last_submitted_at
);

alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;

grant select on public.community_posts, public.community_comments to anon, authenticated;
grant insert, update, delete on public.community_posts, public.community_comments to authenticated;

drop policy if exists "community posts are public" on public.community_posts;
create policy "community posts are public" on public.community_posts
for select to anon, authenticated using (true);

drop policy if exists "community comments are public" on public.community_comments;
create policy "community comments are public" on public.community_comments
for select to anon, authenticated using (true);

drop policy if exists "members create community posts" on public.community_posts;
create policy "members create community posts" on public.community_posts
for insert to authenticated with check (author_id = auth.uid());

drop policy if exists "authors update own community posts" on public.community_posts;
create policy "authors update own community posts" on public.community_posts
for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "authors delete own community posts" on public.community_posts;
create policy "authors delete own community posts" on public.community_posts
for delete to authenticated using (author_id = auth.uid());

drop policy if exists "members create community comments" on public.community_comments;
create policy "members create community comments" on public.community_comments
for insert to authenticated with check (author_id = auth.uid());

drop policy if exists "authors delete own community comments" on public.community_comments;
create policy "authors delete own community comments" on public.community_comments
for delete to authenticated using (author_id = auth.uid());

create or replace function public.prepare_community_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_username text;
  v_last_submission timestamptz;
  v_now timestamptz;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception using errcode = '42501', message = '커뮤니티 글과 댓글은 로그인 후 작성할 수 있습니다.';
  end if;

  -- Serialize all submissions by the same member to prevent simultaneous bypasses.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));
  -- Use wall-clock time after acquiring the lock, not transaction start time.
  v_now := pg_catalog.clock_timestamp();

  select limits.last_submitted_at into v_last_submission
  from public.community_submission_limits limits
  where limits.author_id = v_user_id;

  if v_last_submission is not null and v_last_submission > v_now - interval '30 seconds' then
    raise exception using
      errcode = 'P0001',
      message = '도배 방지를 위해 작성 후 30초가 지나야 다음 글이나 댓글을 작성할 수 있습니다.';
  end if;

  select p.username into v_username
  from public.user_profiles p
  where p.user_id = v_user_id;

  if v_username is null then
    v_username := coalesce(
      nullif(auth.jwt() -> 'user_metadata' ->> 'username', ''),
      '회원'
    );
  end if;

  insert into public.community_submission_limits (author_id, last_submitted_at)
  values (v_user_id, v_now)
  on conflict (author_id) do update
  set last_submitted_at = excluded.last_submitted_at;

  new.author_id := v_user_id;
  new.author_name := v_username;
  new.created_at := v_now;
  if tg_table_name = 'community_posts' then
    new.updated_at := v_now;
  end if;
  return new;
end;
$$;

revoke all on function public.prepare_community_submission() from public;
drop trigger if exists community_posts_cooldown on public.community_posts;
create trigger community_posts_cooldown
before insert on public.community_posts
for each row execute function public.prepare_community_submission();

drop trigger if exists community_comments_cooldown on public.community_comments;
create trigger community_comments_cooldown
before insert on public.community_comments
for each row execute function public.prepare_community_submission();
