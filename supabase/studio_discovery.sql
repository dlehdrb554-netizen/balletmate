-- Auto-discovery via Kakao Local Search. Run after base schema and studio_intake.sql.
create table if not exists public.studio_discovery_regions(id integer primary key,region_name text not null,latitude double precision not null,longitude double precision not null,radius_m integer not null default 20000 check(radius_m between 1000 and 20000));
insert into public.studio_discovery_regions values
(1,'서울 강남',37.5172,127.0473,10000),(2,'서울 강북',37.6396,127.0257,10000),(3,'서울 강동',37.5301,127.1238,10000),(4,'서울 강서',37.5509,126.8495,10000),(5,'서울 관악',37.4784,126.9516,10000),(6,'서울 광진',37.5385,127.0823,10000),(7,'서울 구로',37.4954,126.8874,10000),(8,'서울 금천',37.4568,126.8955,10000),(9,'서울 노원',37.6542,127.0568,10000),(10,'서울 도봉',37.6688,127.0471,10000),(11,'서울 동대문',37.5744,127.0396,10000),(12,'서울 동작',37.5124,126.9393,10000),(13,'서울 마포',37.5663,126.9019,10000),(14,'서울 서대문',37.5791,126.9368,10000),(15,'서울 서초',37.4837,127.0324,10000),(16,'서울 성동',37.5633,127.0369,10000),(17,'서울 성북',37.5894,127.0167,10000),(18,'서울 송파',37.5145,127.1059,10000),(19,'서울 양천',37.5170,126.8665,10000),(20,'서울 영등포',37.5264,126.8963,10000),(21,'서울 용산',37.5326,126.9900,10000),(22,'서울 은평',37.6027,126.9291,10000),(23,'서울 종로',37.5729,126.9793,10000),(24,'서울 중구',37.5636,126.9976,10000),(25,'서울 중랑',37.6063,127.0927,10000),
(26,'인천',37.4563,126.7052,20000),(27,'수원',37.2636,127.0286,20000),(28,'성남',37.42,127.1267,20000),(29,'용인',37.2411,127.1776,20000),(30,'고양',37.6584,126.832,20000),(31,'부천',37.5034,126.766,15000),(32,'안산',37.3219,126.8309,20000),(33,'안양',37.3943,126.9568,15000),(34,'의정부',37.7381,127.0337,15000),(35,'남양주',37.636,127.2165,20000),(36,'파주',37.759,126.78,20000),(37,'김포',37.6152,126.7156,20000),(38,'평택',36.9921,127.1127,20000),(39,'화성',37.1995,126.8312,20000),(40,'부산',35.1796,129.0756,20000),(41,'대구',35.8714,128.6014,20000),(42,'광주',35.1595,126.8526,20000),(43,'대전',36.3504,127.3845,20000),(44,'울산',35.5384,129.3114,20000),(45,'세종',36.48,127.289,20000),(46,'춘천',37.8813,127.7298,20000),(47,'원주',37.3422,127.9202,20000),(48,'강릉',37.7519,128.8761,20000),(49,'청주',36.6424,127.4890,20000),(50,'천안',36.8151,127.1139,20000),(51,'아산',36.7898,127.0025,20000),(52,'전주',35.8242,127.1480,20000),(53,'군산',35.9676,126.7365,20000),(54,'익산',35.9483,126.9577,20000),(55,'목포',34.8118,126.3922,20000),(56,'여수',34.7604,127.6622,20000),(57,'순천',34.9506,127.4872,20000),(58,'포항',36.0190,129.3435,20000),(59,'경주',35.8562,129.2247,20000),(60,'구미',36.1195,128.3446,20000),(61,'창원',35.2279,128.6811,20000),(62,'김해',35.2285,128.8894,20000),(63,'진주',35.1795,128.1076,20000),(64,'제주',33.4996,126.5312,20000),(65,'서귀포',33.2541,126.5600,20000)
on conflict(id) do update set region_name=excluded.region_name,latitude=excluded.latitude,longitude=excluded.longitude,radius_m=excluded.radius_m;
create table if not exists public.studio_discovery_cursor(id integer primary key check(id=1),next_region_id integer not null default 1,updated_at timestamptz not null default now());
insert into public.studio_discovery_cursor values(1,1,now()) on conflict(id) do nothing;
create table if not exists public.studio_discovery_runs(id bigint generated always as identity primary key,region_name text not null,queried_at timestamptz not null default now(),result_count integer not null default 0,inserted_count integer not null default 0,duplicate_count integer not null default 0,error text);
alter table public.studio_discovery_runs enable row level security;
grant select on public.studio_discovery_runs to authenticated;
drop policy if exists "admins view studio discovery runs" on public.studio_discovery_runs;
create policy "admins view studio discovery runs" on public.studio_discovery_runs for select to authenticated using(public.is_balletmate_admin());
create or replace function public.next_studio_discovery_region()
returns table(region_name text,latitude double precision,longitude double precision,radius_m integer)
language plpgsql security definer set search_path=public as $$
declare chosen integer;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
 select next_region_id into chosen from public.studio_discovery_cursor where id=1 for update;
 if chosen is null or not exists(select 1 from public.studio_discovery_regions where id=chosen) then chosen:=1; end if;
 return query select r.region_name,r.latitude,r.longitude,r.radius_m from public.studio_discovery_regions r where r.id=chosen;
 update public.studio_discovery_cursor set next_region_id=case when chosen>=(select max(id) from public.studio_discovery_regions) then 1 else chosen+1 end,updated_at=now() where id=1;
end $$;
revoke all on function public.next_studio_discovery_region() from public;
grant execute on function public.next_studio_discovery_region() to service_role;
create or replace function public.register_discovered_studio(p_name text,p_latitude double precision,p_longitude double precision,p_address text,p_phone text,p_place_url text,p_region text)
returns table(inserted boolean,studio_id uuid)
language plpgsql security definer set search_path=public as $$
declare new_id uuid; normalized text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
 if p_name is null or length(trim(p_name))<2 or p_latitude not between 33 and 39 or p_longitude not between 124 and 132 then return query select false,null::uuid;return;end if;
 normalized:=lower(regexp_replace(trim(p_name),'[^a-z0-9가-힣]','','g'));
 -- Exact Kakao place URL is the strongest identity. Phone numbers are not globally unique
 -- (a business may reuse one number across branches), so phone/name matches also require proximity.
 select s.id into new_id from public.studios s
 where (p_place_url is not null and trim(p_place_url)<>'' and s.source_url=p_place_url)
 or (
   s.latitude is not null and s.longitude is not null
   and p_address is not null and trim(p_address)<>''
   and coalesce(s.address,'')<>''
   and lower(regexp_replace(s.address,'[[:space:]]','','g'))=lower(regexp_replace(p_address,'[[:space:]]','','g'))
   and sqrt(power((s.latitude-p_latitude)*111.0,2)+power((s.longitude-p_longitude)*111.0*cos(radians(p_latitude)),2))<=0.10
   and (
     (p_phone is not null and trim(p_phone)<>'' and regexp_replace(coalesce(s.phone,''),'[^0-9]','','g')<>''
      and regexp_replace(s.phone,'[^0-9]','','g')=regexp_replace(p_phone,'[^0-9]','','g'))
     or lower(regexp_replace(trim(s.name),'[^a-z0-9가-힣]','','g'))=normalized
   )
 )
 order by
   case when p_place_url is not null and s.source_url=p_place_url then 0 else 1 end,
   s.created_at asc
 limit 1;
 if new_id is not null then return query select false,new_id;return;end if;
 insert into public.studios(name,latitude,longitude,district,address,phone,source_url,source_name,verified_at,is_active,adult_classes,kids_classes,updated_at)
 values(trim(p_name),p_latitude,p_longitude,p_region,p_address,nullif(trim(p_phone),''),nullif(p_place_url,''),'Kakao Local Search 자동 발견',now(),true,false,false,now()) returning id into new_id;
 return query select true,new_id;
end $$;
revoke all on function public.register_discovered_studio(text,double precision,double precision,text,text,text,text) from public;
grant execute on function public.register_discovered_studio(text,double precision,double precision,text,text,text,text) to service_role;
