-- Merge administrator-confirmed class schedules into map search filters.
-- This view uses invoker permissions and only reads public active rows.
CREATE OR REPLACE VIEW public.studio_map_search_app
WITH (security_invoker = true) AS
SELECT
  s.*,
  COALESCE((
    SELECT array_agg(DISTINCT CASE WHEN cs.weekday BETWEEN 1 AND 5 THEN '평일' ELSE '주말' END)
    FROM public.classes c
    JOIN public.class_sessions cs ON cs.class_id = c.id
    WHERE c.studio_id = s.id AND c.is_active = true AND cs.is_active = true
  ), ARRAY[]::text[]) AS search_days,
  COALESCE((
    SELECT array_agg(DISTINCT CASE
      WHEN cs.start_time < TIME '12:00' THEN '오전'
      WHEN cs.start_time < TIME '18:00' THEN '오후'
      ELSE '저녁' END)
    FROM public.classes c
    JOIN public.class_sessions cs ON cs.class_id = c.id
    WHERE c.studio_id = s.id AND c.is_active = true AND cs.is_active = true
  ), ARRAY[]::text[]) AS search_time_slots,
  COALESCE((
    SELECT array_agg(DISTINCT c.level)
    FROM public.classes c
    WHERE c.studio_id = s.id AND c.is_active = true AND c.level IS NOT NULL AND length(trim(c.level)) > 0
  ), ARRAY[]::text[]) AS search_levels,
  COALESCE((
    SELECT array_agg(DISTINCT c.duration_minutes)
    FROM public.classes c
    WHERE c.studio_id = s.id AND c.is_active = true AND c.duration_minutes IS NOT NULL
  ), ARRAY[]::integer[]) AS search_class_durations,
  (
    SELECT min(c.price)
    FROM public.classes c
    WHERE c.studio_id = s.id AND c.is_active = true AND c.price IS NOT NULL
  ) AS search_price,
  COALESCE((
    SELECT bool_or(c.audience IN ('adult','all'))
    FROM public.classes c WHERE c.studio_id=s.id AND c.is_active=true
  ), false) AS search_adult,
  COALESCE((
    SELECT bool_or(c.audience IN ('kids','all'))
    FROM public.classes c WHERE c.studio_id=s.id AND c.is_active=true
  ), false) AS search_kids
FROM public.studios s
WHERE s.is_active = true;

GRANT SELECT ON public.studio_map_search_app TO anon, authenticated;
COMMENT ON VIEW public.studio_map_search_app IS
  'Map search metadata merged from administrator-confirmed active class and schedule rows; public data only.';
