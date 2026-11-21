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
