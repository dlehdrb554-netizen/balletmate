-- Official-site public information evidence collected by the crawler.
-- Does not overwrite structured price/time fields or administrator-entered values.
alter table public.studios
  add column if not exists price_evidence_text text,
  add column if not exists schedule_evidence_text text,
  add column if not exists details_source_urls text[] not null default '{}',
  add column if not exists details_checked_at timestamptz,
  add column if not exists details_status text;
