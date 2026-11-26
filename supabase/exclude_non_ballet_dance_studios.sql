-- Exclude non-ballet dance businesses from new discovery and existing NEIS eligibility.
-- Keep source rows for audit; prevent them from entering matching/verification.

UPDATE public.neis_ballet_academy_candidates
SET eligible=false,
    eligibility_reason='excluded_non_ballet_dance_style',
    updated_at=now()
WHERE concat_ws(' ',academy_name,field_name,teaching_affiliation,course_list,course_name)
  ~* '(댄스[[:space:]]*스튜디오|댄스[[:space:]]*스포츠|폴[[:space:]]*댄스|(밸리|벨리)[[:space:]]*댄스|dance[[:space:]]*studio|dance[[:space:]]*sports|pole[[:space:]]*dance|belly[[:space:]]*dance)';

create or replace function public.register_discovered_studio(
 p_name text,p_latitude double precision,p_longitude double precision,
 p_address text,p_phone text,p_place_url text,p_region text
)
returns table(inserted boolean,studio_id uuid)
language plpgsql security definer set search_path=public as $$
declare new_id uuid; normalized_name text; normalized_phone text; normalized_url text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
 if p_name is null or length(trim(p_name))<2 or p_latitude is null or p_longitude is null
    or p_latitude not between 33 and 39 or p_longitude not between 124 and 132 then
  return query select false,null::uuid; return;
 end if;
 if (p_name ~* '(댄스[[:space:]]*스튜디오|댄스[[:space:]]*스포츠|폴[[:space:]]*댄스|(밸리|벨리)[[:space:]]*댄스|dance[[:space:]]*studio|dance[[:space:]]*sports|pole[[:space:]]*dance|belly[[:space:]]*dance)') then
  return query select false,null::uuid; return;
 end if;
 normalized_name:=lower(regexp_replace(trim(p_name),'[^a-z0-9가-힣]','','g'));
 normalized_phone:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 normalized_url:=nullif(regexp_replace(trim(coalesce(p_place_url,'')),'/+$',''),'');
 if normalized_url is not null then
  select s.id into new_id from public.studios s
  where regexp_replace(trim(coalesce(s.source_url,'')),'/+$','')=normalized_url
  order by s.created_at asc limit 1;
 end if;
 if new_id is null then
  select s.id into new_id from public.studios s
  where nullif(regexp_replace(trim(coalesce(s.address,'')),'[^a-z0-9가-힣]','','g'),'') is not null
    and nullif(regexp_replace(trim(coalesce(p_address,'')),'[^a-z0-9가-힣]','','g'),'') is not null
    and lower(regexp_replace(trim(s.address),'[^a-z0-9가-힣]','','g'))=lower(regexp_replace(trim(p_address),'[^a-z0-9가-힣]','','g'))
    and sqrt(power((s.latitude-p_latitude)*111.0,2)+power((s.longitude-p_longitude)*111.0*cos(radians(p_latitude)),2))<=0.10
    and (lower(regexp_replace(trim(s.name),'[^a-z0-9가-힣]','','g'))=normalized_name
      or (normalized_phone<>'' and regexp_replace(coalesce(s.phone,''),'[^0-9]','','g')=normalized_phone))
  order by s.created_at asc limit 1;
 end if;
 if new_id is null then
  select s.id into new_id from public.studios s
  where normalized_name<>'' and lower(regexp_replace(trim(s.name),'[^a-z0-9가-힣]','','g'))=normalized_name
    and (nullif(trim(coalesce(s.address,'')),'') is null or nullif(trim(coalesce(p_address,'')),'') is null)
    and sqrt(power((s.latitude-p_latitude)*111.0,2)+power((s.longitude-p_longitude)*111.0*cos(radians(p_latitude)),2))<=0.035
  order by s.created_at asc limit 1;
 end if;
 if new_id is not null then return query select false,new_id; return; end if;
 insert into public.studios(name,latitude,longitude,district,address,phone,source_url,source_name,verified_at,is_active,adult_classes,kids_classes,updated_at)
 values(trim(p_name),p_latitude,p_longitude,p_region,p_address,nullif(trim(coalesce(p_phone,'')),''),normalized_url,
  'Kakao Local Search 자동 발견',now(),true,false,false,now()) returning id into new_id;
 return query select true,new_id;
end $$;
revoke all on function public.register_discovered_studio(text,double precision,double precision,text,text,text,text) from public;
grant execute on function public.register_discovered_studio(text,double precision,double precision,text,text,text,text) to service_role;

