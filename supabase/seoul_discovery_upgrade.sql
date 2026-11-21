-- Seoul-first discovery upgrade.
-- Run once in Supabase SQL Editor after deploying the updated studio-discovery-worker.
-- Keeps existing studio IDs and existing non-empty data intact.

create or replace function public.register_discovered_studio(
 p_name text,p_latitude double precision,p_longitude double precision,
 p_address text,p_phone text,p_place_url text,p_region text
)
returns table(inserted boolean,studio_id uuid)
language plpgsql security definer set search_path=public as $$
declare new_id uuid; normalized text;
begin
 if coalesce(auth.role(),'')<>'service_role' then
  raise exception 'service role required' using errcode='42501';
 end if;
 if p_name is null or length(trim(p_name))<2
    or p_latitude not between 33 and 39
    or p_longitude not between 124 and 132 then
  return query select false,null::uuid;
  return;
 end if;

 normalized:=lower(regexp_replace(trim(p_name),'[^a-z0-9가-힣]','','g'));
 select s.id into new_id
 from public.studios s
 where (p_phone is not null and trim(p_phone)<>''
        and regexp_replace(coalesce(s.phone,''),'[^0-9]','','g')=regexp_replace(p_phone,'[^0-9]','','g'))
    or (lower(regexp_replace(trim(s.name),'[^a-z0-9가-힣]','','g'))=normalized
        and (coalesce(s.address,'')=coalesce(p_address,'')
          or sqrt(power((s.latitude-p_latitude)*111.0,2)
          +power((s.longitude-p_longitude)*111.0*cos(radians(p_latitude)),2))<=0.30))
 order by s.created_at asc
 limit 1;

 if new_id is not null then
  -- Enrich only blank fields; never replace administrator-maintained values.
  update public.studios
  set address=coalesce(nullif(trim(address),''),nullif(trim(p_address),'')),
      phone=coalesce(nullif(trim(phone),''),nullif(trim(p_phone),'')),
      source_url=coalesce(nullif(trim(source_url),''),nullif(trim(p_place_url),'')),
      source_name=coalesce(nullif(trim(source_name),''),'Kakao Local Search'),
      district=coalesce(nullif(trim(district),''),nullif(trim(p_region),'')),
      updated_at=now()
  where id=new_id;
  return query select false,new_id;
  return;
 end if;

 insert into public.studios(
  name,latitude,longitude,district,address,phone,source_url,source_name,
  is_active,adult_classes,kids_classes,updated_at
 )
 values(
  trim(p_name),p_latitude,p_longitude,nullif(trim(p_region),''),nullif(trim(p_address),''),
  nullif(trim(p_phone),''),nullif(trim(p_place_url),''),'Kakao Local Search',
  true,false,false,now()
 )
 returning id into new_id;
 return query select true,new_id;
end $$;

revoke all on function public.register_discovered_studio(text,double precision,double precision,text,text,text,text) from public;
grant execute on function public.register_discovered_studio(text,double precision,double precision,text,text,text,text) to service_role;

-- Start the next scheduled pass at the first Seoul district.
-- The existing cursor then proceeds through Seoul districts before other cities.
update public.studio_discovery_cursor
set next_region_id=1,updated_at=now()
where id=1;


-- If any Kakao request or record upsert fails, retry this same region next run
-- instead of silently skipping it for an entire 65-region cycle.
create or replace function public.retry_studio_discovery_region(p_region_name text)
returns void
language plpgsql security definer set search_path=public as $$
declare target_id integer;
begin
 if coalesce(auth.role(),'')<>'service_role' then
  raise exception 'service role required' using errcode='42501';
 end if;
 select id into target_id from public.studio_discovery_regions
 where region_name=p_region_name order by id limit 1;
 if target_id is not null then
  update public.studio_discovery_cursor
  set next_region_id=target_id,updated_at=now()
  where id=1;
 end if;
end $$;
revoke all on function public.retry_studio_discovery_region(text) from public;
grant execute on function public.retry_studio_discovery_region(text) to service_role;


-- Discovery priority: Seoul -> Gyeonggi -> Incheon -> other regions.
-- Map by region name so this migration remains safe to re-run.
-- Temporary negative IDs avoid primary-key collisions during the reorder.
begin;
update public.studio_discovery_regions set id = -id where id > 25;
update public.studio_discovery_regions
set id = case region_name
 when '수원' then 26 when '성남' then 27 when '용인' then 28
 when '고양' then 29 when '부천' then 30 when '안산' then 31
 when '안양' then 32 when '의정부' then 33 when '남양주' then 34
 when '파주' then 35 when '김포' then 36 when '평택' then 37
 when '화성' then 38 when '인천' then 39
 when '부산' then 40 when '대구' then 41 when '광주' then 42
 when '대전' then 43 when '울산' then 44 when '세종' then 45
 when '춘천' then 46 when '원주' then 47 when '강릉' then 48
 when '청주' then 49 when '천안' then 50 when '아산' then 51
 when '전주' then 52 when '군산' then 53 when '익산' then 54
 when '목포' then 55 when '여수' then 56 when '순천' then 57
 when '포항' then 58 when '경주' then 59 when '구미' then 60
 when '창원' then 61 when '김해' then 62 when '진주' then 63
 when '제주' then 64 when '서귀포' then 65
 else -id end
where id < 0;
update public.studio_discovery_cursor set next_region_id=1,updated_at=now() where id=1;
commit;
