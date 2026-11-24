-- Kakao Local discovery. Includes 123 regions; run after schema.sql.
create table if not exists public.studio_discovery_regions(id integer primary key,region_name text not null,latitude double precision not null,longitude double precision not null,radius_m integer not null default 20000 check(radius_m between 1000 and 20000));
insert into public.studio_discovery_regions values
(1,'서울 강남',37.5172,127.0473,10000),(2,'서울 강북',37.6396,127.0257,10000),(3,'서울 강동',37.5301,127.1238,10000),(4,'서울 강서',37.5509,126.8495,10000),(5,'서울 관악',37.4784,126.9516,10000),(6,'서울 광진',37.5385,127.0823,10000),(7,'서울 구로',37.4954,126.8874,10000),(8,'서울 금천',37.4568,126.8955,10000),(9,'서울 노원',37.6542,127.0568,10000),(10,'서울 도봉',37.6688,127.0471,10000),(11,'서울 동대문',37.5744,127.0396,10000),(12,'서울 동작',37.5124,126.9393,10000),(13,'서울 마포',37.5663,126.9019,10000),(14,'서울 서대문',37.5791,126.9368,10000),(15,'서울 서초',37.4837,127.0324,10000),(16,'서울 성동',37.5633,127.0369,10000),(17,'서울 성북',37.5894,127.0167,10000),(18,'서울 송파',37.5145,127.1059,10000),(19,'서울 양천',37.5170,126.8665,10000),(20,'서울 영등포',37.5264,126.8963,10000),(21,'서울 용산',37.5326,126.9900,10000),(22,'서울 은평',37.6027,126.9291,10000),(23,'서울 종로',37.5729,126.9793,10000),(24,'서울 중구',37.5636,126.9976,10000),(25,'서울 중랑',37.6063,127.0927,10000),
(39,'인천',37.4563,126.7052,20000),(26,'수원',37.2636,127.0286,20000),(27,'성남',37.42,127.1267,20000),(28,'용인',37.2411,127.1776,20000),(29,'고양',37.6584,126.832,20000),(30,'부천',37.5034,126.766,15000),(31,'안산',37.3219,126.8309,20000),(32,'안양',37.3943,126.9568,15000),(33,'의정부',37.7381,127.0337,15000),(34,'남양주',37.636,127.2165,20000),(35,'파주',37.759,126.78,20000),(36,'김포',37.6152,126.7156,20000),(37,'평택',36.9921,127.1127,20000),(38,'화성',37.1995,126.8312,20000),(40,'부산',35.1796,129.0756,20000),(41,'대구',35.8714,128.6014,20000),(42,'광주',35.1595,126.8526,20000),(43,'대전',36.3504,127.3845,20000),(44,'울산',35.5384,129.3114,20000),(45,'세종',36.48,127.289,20000),(46,'춘천',37.8813,127.7298,20000),(47,'원주',37.3422,127.9202,20000),(48,'강릉',37.7519,128.8761,20000),(49,'청주',36.6424,127.4890,20000),(50,'천안',36.8151,127.1139,20000),(51,'아산',36.7898,127.0025,20000),(52,'전주',35.8242,127.1480,20000),(53,'군산',35.9676,126.7365,20000),(54,'익산',35.9483,126.9577,20000),(55,'목포',34.8118,126.3922,20000),(56,'여수',34.7604,127.6622,20000),(57,'순천',34.9506,127.4872,20000),(58,'포항',36.0190,129.3435,20000),(59,'경주',35.8562,129.2247,20000),(60,'구미',36.1195,128.3446,20000),(61,'창원',35.2279,128.6811,20000),(62,'김해',35.2285,128.8894,20000),(63,'진주',35.1795,128.1076,20000),(64,'제주',33.4996,126.5312,20000),(65,'서귀포',33.2541,126.5600,20000),
(66,'고양 백석',37.6468,126.7895,7000),(67,'고양 화정',37.6347,126.8327,7000),(68,'고양 행신',37.6127,126.8340,7000),(69,'고양 삼송',37.6532,126.8950,7000),(70,'고양 일산',37.6750,126.7690,7000),(71,'고양 대화',37.6760,126.7470,7000),
(72,'파주 운정',37.7150,126.7450,8000),(73,'파주 금촌',37.7600,126.7720,8000),(74,'파주 문산',37.8590,126.7860,8000),(75,'파주 월롱',37.7960,126.7920,6000),(76,'파주 파주읍',37.8310,126.8170,6000),
(77,'천안 불당',36.8010,127.1080,7000),(78,'천안 두정',36.8330,127.1350,7000),(79,'천안 성정',36.8180,127.1370,6000),(80,'천안 쌍용',36.7890,127.1200,7000),(81,'천안 신부',36.8190,127.1540,6000),(82,'천안 백석',36.8270,127.1160,6000),
(83,'수원 광교',37.2920,127.0520,8000),(84,'수원 영통',37.2510,127.0710,7000),(85,'수원 인계',37.2650,127.0300,7000),(86,'수원 권선',37.2570,126.9710,8000),(87,'수원 장안',37.3000,127.0010,7000),
(88,'인천 송도',37.3820,126.6560,8000),(89,'인천 부평',37.5070,126.7210,7000),(90,'인천 구월',37.4480,126.7040,7000),(91,'인천 청라',37.5330,126.6530,8000),
(92,'부산 서면',35.1570,129.0600,7000),(93,'부산 해운대',35.1630,129.1630,8000),(94,'부산 남포',35.0980,129.0300,7000),(95,'부산 동래',35.2050,129.0830,7000),(96,'부산 사하',35.1040,128.9740,7000),
(97,'대구 수성',35.8580,128.6310,7000),(98,'대구 동성로',35.8700,128.5970,7000),(99,'대구 달서',35.8290,128.5320,8000),(100,'대구 칠곡',35.9410,128.5660,7000),
(101,'대전 둔산',36.3510,127.3780,7000),(102,'대전 유성',36.3620,127.3560,8000),(103,'대전 관저',36.3040,127.3360,7000),(104,'대전 중구',36.3250,127.4210,7000),
(105,'서울 마곡',37.5600,126.8260,6000),(106,'서울 목동',37.5260,126.8750,6000),(107,'서울 화곡',37.5410,126.8400,6000),(108,'서울 까치산',37.5310,126.8480,6000),(109,'서울 천호',37.5390,127.1230,6000),
(110,'성남 분당',37.3780,127.1120,8000),(111,'성남 판교',37.3940,127.1110,7000),(112,'용인 수지',37.3220,127.0970,8000),(113,'용인 기흥',37.2750,127.1150,8000),(114,'김포 구래',37.6450,126.6280,7000),(115,'김포 장기',37.6440,126.6680,7000),
(116,'청주 복대',36.6350,127.4320,7000),(117,'청주 율량',36.6650,127.4990,7000),(118,'청주 오창',36.7190,127.4340,8000),(119,'울산 삼산',35.5400,129.3370,7000),(120,'창원 상남',35.2200,128.6860,7000),(121,'전주 효자',35.8060,127.1160,7000),(122,'광주 상무',35.1510,126.8490,7000),(123,'제주 노형',33.4850,126.4810,7000)
on conflict(id) do update set region_name=excluded.region_name,latitude=excluded.latitude,longitude=excluded.longitude,radius_m=excluded.radius_m;
create table if not exists public.studio_discovery_cursor(id integer primary key check(id=1),next_region_id integer not null default 1,updated_at timestamptz not null default now());
insert into public.studio_discovery_cursor values(1,1,now()) on conflict(id) do nothing;
-- Restart at Seoul after the canonical region order is applied.
update public.studio_discovery_cursor set next_region_id=1,updated_at=now() where id=1;
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

-- Retry the same region when any Kakao request or registration fails.
create or replace function public.retry_studio_discovery_region(p_region_name text)
returns void language plpgsql security definer set search_path=public as $$
declare chosen integer;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
 select id into chosen from public.studio_discovery_regions where region_name=p_region_name order by id limit 1;
 if chosen is null then raise exception 'unknown discovery region: %',p_region_name; end if;
 update public.studio_discovery_cursor set next_region_id=chosen,updated_at=now() where id=1;
end $$;
revoke all on function public.retry_studio_discovery_region(text) from public;
grant execute on function public.retry_studio_discovery_region(text) to service_role;

-- Exact Kakao place URL wins. Otherwise only merge a same-address, nearby match
-- when the academy name or phone also agrees; phone alone never merges branches.
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
