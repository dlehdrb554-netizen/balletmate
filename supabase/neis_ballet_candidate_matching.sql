-- NEIS candidate-to-existing-studio matching. Safe to rerun.
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
  with normalized as (
    select c.id candidate_id,
      regexp_replace(lower(coalesce(c.academy_name,'')), '[^a-z0-9가-힣]', '', 'g') c_name,
      regexp_replace(lower(coalesce(c.address,'')), '[^a-z0-9가-힣]', '', 'g') c_address,
      regexp_replace(coalesce(c.academy_phone,''), '[^0-9]', '', 'g') c_phone
    from public.neis_ballet_academy_candidates c
    where c.review_status='pending' and c.matched_studio_id is null
  ), studios_normalized as (
    select s.id studio_id,
      regexp_replace(lower(coalesce(s.name,'')), '[^a-z0-9가-힣]', '', 'g') s_name,
      regexp_replace(lower(coalesce(s.address,'')), '[^a-z0-9가-힣]', '', 'g') s_address,
      regexp_replace(coalesce(s.phone,''), '[^0-9]', '', 'g') s_phone
    from public.studios s
  ), possible as (
    select c.candidate_id, s.studio_id,
      (c.c_name<>'' and c.c_name=s.s_name) name_match,
      (c.c_address<>'' and s.s_address<>'' and c.c_address=s.s_address) address_match,
      (c.c_phone<>'' and s.s_phone<>'' and c.c_phone=s.s_phone) phone_match
    from normalized c cross join studios_normalized s
  ), confident as (
    select candidate_id, studio_id
    from possible
    where (name_match and (address_match or phone_match))
       or (address_match and phone_match)
  ), unique_matches as (
    select candidate_id, (array_agg(studio_id order by studio_id))[1] studio_id
    from confident
    group by candidate_id
    having count(distinct studio_id)=1
  )
  update public.neis_ballet_academy_candidates c
    set matched_studio_id=u.studio_id, review_status='matched', updated_at=now()
  from unique_matches u
  where c.id=u.candidate_id;
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

-- Initial deduplication pass.
select public.match_neis_ballet_candidates() as matched_existing_studios;
