-- Prevent review owners from moving reviews between studios or resetting the
-- 24-hour creation limit by changing immutable fields through direct API updates.
CREATE OR REPLACE FUNCTION public.guard_studio_review_abuse()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_verified_at timestamptz;
  v_report_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id <> auth.uid() THEN
      RAISE EXCEPTION '본인 계정으로만 리뷰를 작성할 수 있습니다.';
    END IF;

    IF (
      SELECT count(*)
      FROM public.studio_reviews
      WHERE user_id = NEW.user_id
        AND created_at > now() - interval '24 hours'
    ) >= 3 THEN
      RAISE EXCEPTION '리뷰는 24시간에 최대 3개까지 작성할 수 있습니다.';
    END IF;

    NEW.created_at := now();
    NEW.updated_at := now();

    SELECT verified_at INTO v_verified_at
    FROM public.studio_review_verifications
    WHERE studio_id = NEW.studio_id AND user_id = NEW.user_id;

    NEW.verified_at := v_verified_at;
    NEW.is_hidden := false;
    NEW.hidden_reason := NULL;
    RETURN NEW;
  END IF;

  -- The review identity and creation timestamp are immutable for every update.
  NEW.id := OLD.id;
  NEW.user_id := OLD.user_id;
  NEW.studio_id := OLD.studio_id;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();

  IF OLD.user_id <> auth.uid() THEN
    SELECT count(DISTINCT reporter_id) INTO v_report_count
    FROM public.studio_review_reports
    WHERE review_id = OLD.id;

    IF NOT public.is_balletmate_admin()
       AND NOT (NEW.is_hidden = true AND v_report_count >= 3) THEN
      RAISE EXCEPTION '본인 리뷰만 수정할 수 있습니다.';
    END IF;

    -- Moderation/report automation may change visibility only.
    NEW.rating := OLD.rating;
    NEW.content := OLD.content;
    NEW.verified_at := OLD.verified_at;
  ELSE
    IF OLD.updated_at > now() - interval '10 minutes' THEN
      RAISE EXCEPTION '리뷰 수정은 10분 간격으로 가능합니다.';
    END IF;

    NEW.is_hidden := OLD.is_hidden;
    NEW.hidden_reason := OLD.hidden_reason;

    SELECT verified_at INTO v_verified_at
    FROM public.studio_review_verifications
    WHERE studio_id = OLD.studio_id AND user_id = OLD.user_id;
    NEW.verified_at := v_verified_at;
  END IF;

  RETURN NEW;
END;
$$;
