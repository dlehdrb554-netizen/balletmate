-- NEIS candidate-to-existing-studio matching and diagnostics. Safe to rerun.
alter table public.neis_ballet_academy_candidates
  add column if not exists academy_phone text;

create or replace function public.match_neis_ballet_candidates()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare matched_count integer := 0;
begin
  with possible as (
    select c.id candidate_id, s.id studio_id,
      (regexp_replace(lower(coalesce(c.academy_name,'')), '[^a-z0-9가-힣]', '', 'g') =
       regexp_replace(lower(coalesce(s.name,'')), '[^a-z0-9가-힣]', '', 'g')) name_match,
      (regexp_replace(lower(coalesce(c.address,'')), '[^a-z0-9가-힣]', '', 'g') =
       regexp_replace(lower(coalesce(s.address,'')), '[^a-z0-9가-힣]', '', 'g')) address_match,
      (regexp_replace(coalesce(c.academy_phone,''), '[^0-9]', '', 'g') <> '' and
       regexp_replace(coalesce(c.academy_phone,''), '[^0-9]', '', 'g') =
       regexp_replace(coalesce(s.phone,''), '[^0-9]', '', 'g')) phone_match
    from public.neis_ballet_academy_candidates c
    join public.studios s on
      regexp_replace(lower(coalesce(c.academy_name,'')), '[^a-z0-9가-힣]', '', 'g') =
      regexp_replace(lower(coalesce(s.name,'')), '[^a-z0-9가-힣]', '', 'g')
    where c.review_status = 'pending' and c.matched_studio_id is null
  ), confident as (
    select candidate_id, studio_id from possible
    where (name_match and address_match and address_match is not false and coalesce(address_match,false))
       or phone_match
  ), unique_matches as (
    select candidate_id, min(studio_id) studio_id
    from confident group by candidate_id having count(*) = 1
  )
  update public.neis_ballet_academy_candidates c
    set matched_studio_id = u.studio_id, review_status = 'matched', updated_at = now()
  from unique_matches u where c.id = u.candidate_id;
  get diagnostics matched_count = row_count;
  return matched_count;
end;
$$;
revoke all on function public.match_neis_ballet_candidates() from public, anon, authenticated;
grant execute on function public.match_neis_ballet_candidates() to service_role;

create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname='balletmate-neis-candidate-matching';
select cron.schedule('balletmate-neis-candidate-matching','*/10 * * * *',
  $$select public.match_neis_ballet_candidates();$$);

-- Run initial matching immediately.
select public.match_neis_ballet_candidates() as matched_existing_studios;
