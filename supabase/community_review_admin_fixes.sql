-- Fix review-report listing, community display names, and administrator deletion.
-- Run once in Supabase SQL Editor. Safe to re-run.

ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS display_name text;

CREATE OR REPLACE FUNCTION public.admin_list_studio_review_reports()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', q.id,
      'review_id', q.review_id,
      'studio_id', r.studio_id,
      'studio_name', s.name,
      'reviewer_id', r.user_id,
      'review_content', r.content,
      'reason', q.reason,
      'details', q.details,
      'status', q.status,
      'created_at', q.created_at
    ) ORDER BY q.created_at DESC)
    FROM (
      SELECT * FROM public.studio_review_reports
      ORDER BY created_at DESC
      LIMIT 100
    ) q
    JOIN public.studio_reviews r ON r.id = q.review_id
    LEFT JOIN public.studios s ON s.id = r.studio_id
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_studio_review_reports() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_studio_review_reports() TO authenticated;

CREATE OR REPLACE FUNCTION public.prepare_community_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_display_name text;
  v_username text;
  v_last_submission timestamptz;
  v_now timestamptz;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501',
      message = '커뮤니티 글과 댓글은 로그인 후 작성할 수 있습니다.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));
  v_now := pg_catalog.clock_timestamp();

  SELECT limits.last_submitted_at INTO v_last_submission
  FROM public.community_submission_limits limits
  WHERE limits.author_id = v_user_id;

  IF v_last_submission IS NOT NULL AND v_last_submission > v_now - interval '30 seconds' THEN
    RAISE EXCEPTION USING errcode = 'P0001',
      message = '도배 방지를 위해 작성 후 30초가 지나야 다음 글이나 댓글을 작성할 수 있습니다.';
  END IF;

  SELECT p.display_name, p.username
  INTO v_display_name, v_username
  FROM public.user_profiles p
  WHERE p.user_id = v_user_id;

  v_display_name := nullif(pg_catalog.btrim(v_display_name), '');
  v_username := nullif(pg_catalog.btrim(v_username), '');

  IF v_display_name IS NULL AND (v_username IS NULL OR v_username LIKE 'social\_%' ESCAPE '\') THEN
    v_display_name := nullif(pg_catalog.btrim(coalesce(
      auth.jwt() -> 'user_metadata' ->> 'nickname',
      auth.jwt() -> 'user_metadata' ->> 'display_name',
      auth.jwt() -> 'user_metadata' ->> 'full_name',
      auth.jwt() -> 'user_metadata' ->> 'name'
    )), '');
  END IF;

  IF v_display_name IS NULL AND v_username IS NOT NULL AND v_username NOT LIKE 'social\_%' ESCAPE '\' THEN
    v_display_name := v_username;
  END IF;
  IF v_display_name IS NULL THEN
    v_display_name := '발레메이트 회원';
  END IF;

  INSERT INTO public.community_submission_limits (author_id, last_submitted_at)
  VALUES (v_user_id, v_now)
  ON CONFLICT (author_id) DO UPDATE
  SET last_submitted_at = excluded.last_submitted_at;

  NEW.author_id := v_user_id;
  NEW.author_name := pg_catalog.left(v_display_name, 40);
  NEW.created_at := v_now;
  IF TG_TABLE_NAME = 'community_posts' THEN
    NEW.updated_at := v_now;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_community_submission() FROM PUBLIC, anon, authenticated;

-- Repair existing content that exposed an internal social_* username.
UPDATE public.community_posts cp
SET author_name = left(coalesce(nullif(trim(up.display_name), ''), '발레메이트 회원'), 40)
FROM public.user_profiles up
WHERE cp.author_id = up.user_id
  AND cp.author_name LIKE 'social\_%' ESCAPE '\';

UPDATE public.community_comments cc
SET author_name = left(coalesce(nullif(trim(up.display_name), ''), '발레메이트 회원'), 40)
FROM public.user_profiles up
WHERE cc.author_id = up.user_id
  AND cc.author_name LIKE 'social\_%' ESCAPE '\';

-- Administrators can delete any community post/comment; regular members remain owner-only.
GRANT DELETE ON public.community_posts, public.community_comments TO authenticated;

DROP POLICY IF EXISTS "admins delete community posts" ON public.community_posts;
CREATE POLICY "admins delete community posts"
ON public.community_posts FOR DELETE TO authenticated
USING (public.is_balletmate_admin());

DROP POLICY IF EXISTS "admins delete community comments" ON public.community_comments;
CREATE POLICY "admins delete community comments"
ON public.community_comments FOR DELETE TO authenticated
USING (public.is_balletmate_admin());
