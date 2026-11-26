-- Server-side abuse protection for the public Kakao academy search endpoint.
-- Apply this SQL before deploying the matching Edge Function.
CREATE TABLE IF NOT EXISTS public.kakao_search_rate_limits (
  client_hash text PRIMARY KEY CHECK (client_hash ~ '^[a-f0-9]{64}$'),
  minute_window_start timestamptz NOT NULL,
  minute_count integer NOT NULL DEFAULT 0 CHECK (minute_count >= 0),
  hour_window_start timestamptz NOT NULL,
  hour_count integer NOT NULL DEFAULT 0 CHECK (hour_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kakao_search_rate_limits_updated_at_idx
  ON public.kakao_search_rate_limits (updated_at);

ALTER TABLE public.kakao_search_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kakao_search_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.kakao_search_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_kakao_search_rate_limit(
  p_client_hash text
)
RETURNS TABLE (
  allowed boolean,
  remaining integer,
  reset_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_minute_start timestamptz;
  v_hour_start timestamptz;
  v_row public.kakao_search_rate_limits%ROWTYPE;
  v_minute_count integer;
  v_hour_count integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF p_client_hash IS NULL OR p_client_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid client hash' USING ERRCODE = '22023';
  END IF;

  v_minute_start := to_timestamp(floor(extract(epoch FROM v_now) / 60) * 60);
  v_hour_start := to_timestamp(floor(extract(epoch FROM v_now) / 3600) * 3600);

  INSERT INTO public.kakao_search_rate_limits (
    client_hash, minute_window_start, minute_count,
    hour_window_start, hour_count, updated_at
  )
  VALUES (p_client_hash, v_minute_start, 0, v_hour_start, 0, v_now)
  ON CONFLICT (client_hash) DO NOTHING;

  SELECT * INTO v_row
  FROM public.kakao_search_rate_limits
  WHERE client_hash = p_client_hash
  FOR UPDATE;

  v_minute_count := CASE
    WHEN v_row.minute_window_start = v_minute_start THEN v_row.minute_count
    ELSE 0
  END;
  v_hour_count := CASE
    WHEN v_row.hour_window_start = v_hour_start THEN v_row.hour_count
    ELSE 0
  END;

  IF v_minute_count >= 15 OR v_hour_count >= 120 THEN
    RETURN QUERY SELECT
      false,
      greatest(0, least(15 - v_minute_count, 120 - v_hour_count)),
      CASE
        WHEN v_minute_count >= 15 THEN v_minute_start + interval '1 minute'
        ELSE v_hour_start + interval '1 hour'
      END;
    RETURN;
  END IF;

  v_minute_count := v_minute_count + 1;
  v_hour_count := v_hour_count + 1;

  UPDATE public.kakao_search_rate_limits
  SET minute_window_start = v_minute_start,
      minute_count = v_minute_count,
      hour_window_start = v_hour_start,
      hour_count = v_hour_count,
      updated_at = v_now
  WHERE client_hash = p_client_hash;

  -- Keep only recent, hashed client counters; no raw IP address is stored.
  DELETE FROM public.kakao_search_rate_limits
  WHERE updated_at < v_now - interval '2 days';

  RETURN QUERY SELECT
    true,
    greatest(0, least(15 - v_minute_count, 120 - v_hour_count)),
    least(v_minute_start + interval '1 minute', v_hour_start + interval '1 hour');
END;
$$;

REVOKE ALL ON FUNCTION public.consume_kakao_search_rate_limit(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_kakao_search_rate_limit(text) TO service_role;
