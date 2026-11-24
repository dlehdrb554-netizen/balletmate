-- Add an explicit copyright/photo takedown category to the existing studio report workflow.
ALTER TABLE public.studio_user_reports
  DROP CONSTRAINT IF EXISTS studio_user_reports_category_check;
ALTER TABLE public.studio_user_reports
  ADD CONSTRAINT studio_user_reports_category_check
  CHECK (category IN ('폐업/이전','주소 오류','전화/홈페이지 오류','가격/시간표 오류','사진 오류','저작권/사진 삭제 요청','기타'));
