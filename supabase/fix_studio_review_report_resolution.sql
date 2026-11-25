-- Keep review visibility consistent with the number of unresolved reports.
-- Dismissing one report must not expose a review while three other reports remain pending.
CREATE OR REPLACE FUNCTION public.admin_resolve_studio_review_report(
 p_report_id bigint,p_action text,p_admin_note text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_review_id uuid;
 v_pending_count integer:=0;
 v_hidden_reason text;
BEGIN
 IF NOT public.is_balletmate_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
 IF p_action NOT IN ('hide','restore','dismiss') THEN RAISE EXCEPTION 'Invalid action'; END IF;

 SELECT review_id INTO v_review_id
 FROM public.studio_review_reports
 WHERE id=p_report_id
 FOR UPDATE;
 IF v_review_id IS NULL THEN RAISE EXCEPTION 'Report not found'; END IF;

 UPDATE public.studio_review_reports SET
  status=CASE WHEN p_action='dismiss' THEN 'dismissed' ELSE 'actioned' END,
  admin_note=nullif(left(coalesce(p_admin_note,''),500),''),
  reviewed_by=auth.uid(),reviewed_at=now()
 WHERE id=p_report_id;

 IF p_action='hide' THEN
  UPDATE public.studio_reviews
  SET is_hidden=true,hidden_reason='관리자 검토 결과 숨김'
  WHERE id=v_review_id;
  RETURN;
 END IF;

 SELECT count(*) INTO v_pending_count
 FROM public.studio_review_reports
 WHERE review_id=v_review_id AND status='pending';

 SELECT hidden_reason INTO v_hidden_reason
 FROM public.studio_reviews
 WHERE id=v_review_id
 FOR UPDATE;

 IF v_pending_count>=3 THEN
  UPDATE public.studio_reviews
  SET is_hidden=true,
      hidden_reason=coalesce(v_hidden_reason,'신고 3건 이상 · 관리자 검토 대기')
  WHERE id=v_review_id;
 ELSIF p_action='restore'
    OR v_hidden_reason='신고 3건 이상 · 관리자 검토 대기' THEN
  UPDATE public.studio_reviews
  SET is_hidden=false,hidden_reason=NULL
  WHERE id=v_review_id;
 END IF;
END $$;

REVOKE ALL ON FUNCTION public.admin_resolve_studio_review_report(bigint,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_studio_review_report(bigint,text,text) TO authenticated;
