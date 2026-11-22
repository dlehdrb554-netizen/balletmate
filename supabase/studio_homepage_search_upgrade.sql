-- Homepage candidate search coverage for both new and existing studios.
-- Run once in Supabase SQL Editor before/after deploying studio-discovery-worker.
alter table public.studios
  add column if not exists homepage_search_checked_at timestamptz;

create index if not exists studios_homepage_search_pending_idx
  on public.studios(created_at)
  where is_active = true
    and website_url is null
    and homepage_search_checked_at is null;
