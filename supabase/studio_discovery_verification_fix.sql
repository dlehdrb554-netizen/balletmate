-- Do not mark automatically discovered Kakao places as manually verified.
-- New records remain visible in the app (is_active=true), but verified_at stays NULL
-- until an administrator checks the listing and its details.
CREATE OR REPLACE FUNCTION public.register_discovered_studio(
  p_name text,
  p_latitude double precision,
  p_longitude double precision,
  p_address text,
  p_phone text,
  p_place_url text,
  p_region text
)
RETURNS TABLE(inserted boolean, studio_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
  normalized text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING errcode = '42501';
  END IF;

  IF p_name IS NULL
     OR length(trim(p_name)) < 2
     OR p_latitude NOT BETWEEN 33 AND 39
     OR p_longitude NOT BETWEEN 124 AND 132 THEN
    RETURN QUERY SELECT false, NULL::uuid;
    RETURN;
  END IF;

  normalized := lower(regexp_replace(trim(p_name), '[^a-z0-9가-힣]', '', 'g'));

  SELECT s.id INTO new_id
  FROM public.studios s
  WHERE (
    p_phone IS NOT NULL
    AND trim(p_phone) <> ''
    AND regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g')
      = regexp_replace(p_phone, '[^0-9]', '', 'g')
  )
  OR (
    lower(regexp_replace(trim(s.name), '[^a-z0-9가-힣]', '', 'g')) = normalized
    AND (
      coalesce(s.address, '') = coalesce(p_address, '')
      OR sqrt(
        power((s.latitude - p_latitude) * 111.0, 2)
        + power((s.longitude - p_longitude) * 111.0 * cos(radians(p_latitude)), 2)
      ) <= 0.30
    )
  )
  ORDER BY s.created_at ASC
  LIMIT 1;

  IF new_id IS NOT NULL THEN
    RETURN QUERY SELECT false, new_id;
    RETURN;
  END IF;

  INSERT INTO public.studios(
    name, latitude, longitude, district, address, phone,
    source_url, source_name, verified_at, is_active,
    adult_classes, kids_classes, updated_at
  )
  VALUES(
    trim(p_name), p_latitude, p_longitude, p_region, p_address,
    nullif(trim(p_phone), ''), nullif(p_place_url, ''),
    'Kakao Local Search 자동 발견', NULL, true,
    false, false, now()
  )
  RETURNING id INTO new_id;

  RETURN QUERY SELECT true, new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_discovered_studio(
  text, double precision, double precision, text, text, text, text
) FROM public;

GRANT EXECUTE ON FUNCTION public.register_discovered_studio(
  text, double precision, double precision, text, text, text, text
) TO service_role;

-- Correct the verification timestamp previously assigned by automatic discovery.
UPDATE public.studios
SET verified_at = NULL
WHERE source_name = 'Kakao Local Search 자동 발견'
  AND verified_at IS NOT NULL;
