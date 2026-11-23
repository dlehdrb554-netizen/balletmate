-- Read-only quality review view for NEIS ballet/dance candidates.
-- Does not approve, reject, or insert studios.
create or replace view public.neis_ballet_candidate_review
with (security_invoker = true)
as
select
  c.id,
  c.academy_name,
  c.district_name,
  c.address,
  c.academy_phone,
  c.registration_status,
  c.is_open,
  c.field_name,
  c.teaching_affiliation,
  c.course_list,
  c.course_name,
  c.review_status,
  c.matched_studio_id,
  case
    when coalesce(c.academy_name,'') ~* '발레|ballet' then 'ballet_name_high'
    when concat_ws(' ', c.field_name, c.teaching_affiliation, c.course_list, c.course_name) ~* '발레|ballet' then 'ballet_course_signal'
    when concat_ws(' ', c.field_name, c.teaching_affiliation, c.course_list, c.course_name) ~* '무용' then 'dance_related_needs_review'
    when coalesce(c.academy_name,'') ~* '댄스|dance' then 'dance_name_needs_review'
    else 'weak_or_unclear'
  end as relevance_bucket,
  case
    when nullif(trim(coalesce(c.address,'')), '') is null then 'missing_address'
    when nullif(trim(coalesce(c.academy_phone,'')), '') is null then 'missing_phone'
    when regexp_replace(coalesce(c.academy_phone,''), '[^0-9]', '', 'g') ~ '^(0{7,}|02?0{6,})$' then 'placeholder_phone'
    else 'address_phone_present'
  end as data_quality,
  case
    when not c.is_open then 'exclude_closed'
    when coalesce(c.academy_name,'') ~* '발레|ballet' then 'priority_verify'
    when concat_ws(' ', c.field_name, c.teaching_affiliation, c.course_list, c.course_name) ~* '발레|ballet' then 'verify_course'
    when concat_ws(' ', c.field_name, c.teaching_affiliation, c.course_list, c.course_name) ~* '무용' then 'manual_review'
    else 'low_priority'
  end as review_priority,
  c.last_seen_at,
  c.created_at,
  c.updated_at
from public.neis_ballet_academy_candidates c;

grant select on public.neis_ballet_candidate_review to authenticated, service_role;
