-- Reorder automatic discovery after Seoul: Gyeonggi/Incheon first, then other regions.
-- Existing studios are preserved; duplicate discovery is handled by register_discovered_studio().
INSERT INTO public.studio_discovery_regions(id,region_name,latitude,longitude,radius_m)
VALUES
(26,'인천',37.4563,126.7052,20000),
(27,'수원',37.2636,127.0286,20000),
(28,'성남',37.42,127.1267,20000),
(29,'용인',37.2411,127.1776,20000),
(30,'고양',37.6584,126.832,20000),
(31,'부천',37.5034,126.766,15000),
(32,'안산',37.3219,126.8309,20000),
(33,'안양',37.3943,126.9568,15000),
(34,'의정부',37.7381,127.0337,15000),
(35,'남양주',37.636,127.2165,20000),
(36,'파주',37.759,126.78,20000),
(37,'김포',37.6152,126.7156,20000),
(38,'평택',36.9921,127.1127,20000),
(39,'화성',37.1995,126.8312,20000),
(40,'부산',35.1796,129.0756,20000),
(41,'대구',35.8714,128.6014,20000),
(42,'광주',35.1595,126.8526,20000),
(43,'대전',36.3504,127.3845,20000),
(44,'울산',35.5384,129.3114,20000),
(45,'세종',36.48,127.289,20000)
ON CONFLICT (id) DO UPDATE
SET region_name=EXCLUDED.region_name,
    latitude=EXCLUDED.latitude,
    longitude=EXCLUDED.longitude,
    radius_m=EXCLUDED.radius_m;

-- Resume at Incheon/Gyeonggi so the rollout order is applied immediately.
UPDATE public.studio_discovery_cursor
SET next_region_id=26, updated_at=now()
WHERE id=1;
