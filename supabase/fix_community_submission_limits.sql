-- Repair missing community submission cooldown ledger.
-- Run in Supabase SQL Editor. Safe to re-run.
-- The trigger function public.prepare_community_submission() already uses this table.

create table if not exists public.community_submission_limits (
  author_id uuid primary key references auth.users(id) on delete cascade,
  last_submitted_at timestamptz not null
);

alter table public.community_submission_limits enable row level security;
revoke all on public.community_submission_limits from public, anon, authenticated;

-- Restore each member's latest post/comment timestamp so the 30-second
-- cooldown cannot be bypassed immediately after this repair.
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

-- Verify that the expected trigger function and triggers are present.
do $$
begin
  if to_regprocedure('public.prepare_community_submission()') is null then
    raise exception 'public.prepare_community_submission() is missing; rerun supabase/community.sql first.';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'community_posts_cooldown'
      and tgrelid = 'public.community_posts'::regclass
      and not tgisinternal
  ) then
    raise exception 'community_posts_cooldown trigger is missing; rerun supabase/community.sql first.';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'community_comments_cooldown'
      and tgrelid = 'public.community_comments'::regclass
      and not tgisinternal
  ) then
    raise exception 'community_comments_cooldown trigger is missing; rerun supabase/community.sql first.';
  end if;
end;
$$;
