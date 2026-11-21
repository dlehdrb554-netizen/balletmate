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
-- Keep Seoul IDs 1-25. Move Gyeonggi (old IDs 33-45) to 26-38,
-- Incheon (old ID 28) to 39, then retain the remaining regional order.
-- Temporary negative IDs avoid primary-key collisions during the reorder.
begin;
update public.studio_discovery_regions set id = -id where id > 25;
update public.studio_discovery_regions
set id = case id
 when -33 then 26 when -34 then 27 when -35 then 28 when -36 then 29
 when -37 then 30 when -38 then 31 when -39 then 32 when -40 then 33
 when -41 then 34 when -42 then 35 when -43 then 36 when -44 then 37
 when -45 then 38 when -28 then 39
 when -26 then 40 when -27 then 41 when -29 then 42 when -30 then 43
 when -31 then 44 when -32 then 45
 when -46 then 46 when -47 then 47 when -48 then 48 when -49 then 49
 when -50 then 50 when -51 then 51 when -52 then 52 when -53 then 53
 when -54 then 54 when -55 then 55 when -56 then 56 when -57 then 57
 when -58 then 58 when -59 then 59 when -60 then 60 when -61 then 61
 when -62 then 62 when -63 then 63 when -64 then 64 when -65 then 65
 else id end
where id < 0;
update public.studio_discovery_cursor set next_region_id=1,updated_at=now() where id=1;
commit;
