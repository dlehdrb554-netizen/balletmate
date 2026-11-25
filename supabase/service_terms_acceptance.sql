-- Service terms acceptance for user-generated content (reviews).\n-- Current terms version: 2026-11-26-ads-1 (advertising clause added).
-- Run once in Supabase SQL Editor. Safe to re-run.
create table if not exists public.service_terms_acceptances (
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_version text not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id, terms_version)
);
alter table public.service_terms_acceptances enable row level security;
revoke all on public.service_terms_acceptances from public, anon, authenticated;
grant select, insert on public.service_terms_acceptances to authenticated;
drop policy if exists "members read own service terms acceptance" on public.service_terms_acceptances;
create policy "members read own service terms acceptance"
  on public.service_terms_acceptances for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "members accept service terms" on public.service_terms_acceptances;
create policy "members accept service terms"
  on public.service_terms_acceptances for insert to authenticated
  with check (user_id = auth.uid());

create or replace function public.require_service_terms_for_studio_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.user_id = auth.uid()
     and not exists (
       select 1 from public.service_terms_acceptances a
       where a.user_id = auth.uid() and a.terms_version = '2026-11-26-ads-1'
     ) then
    raise exception using errcode = '42501',
      message = '리뷰를 작성하거나 수정하려면 서비스 이용약관 동의가 필요합니다.';
  end if;
  return new;
end;
$$;
revoke all on function public.require_service_terms_for_studio_review() from public, anon, authenticated;
drop trigger if exists studio_reviews_require_service_terms on public.studio_reviews;
create trigger studio_reviews_require_service_terms
  before insert or update on public.studio_reviews
  for each row execute function public.require_service_terms_for_studio_review();
