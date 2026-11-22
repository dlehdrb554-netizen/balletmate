# 사진 AI 자동 분류 및 공개 연계 설정

## 1회 설정
1. Supabase SQL Editor에서 순서대로 실행:
   - `studio_photo_review.sql` (후보 테이블)
   - `studio_photo_material_classification.sql` (자료 유형)
   - `studio_photo_auto_classification.sql` (AI 분류 필드)
   - `studio_photo_auto_publish.sql` (기존 갤러리·수집 사진을 전수 후보로 등록)
2. Supabase Edge Function Secrets에 `GOOGLE_GEMINI_API_KEY`를 등록합니다.
3. GitHub Actions `Deploy Balletmate Supabase Workers`가 함수 배포를 수행합니다.

## 자동 정책
- AI가 시각적 유형만 판별합니다. OCR이나 사진 속 문자를 읽지 않습니다.
- 발레 수업, 시간표, 가격표, 발레 홍보 포스터이며 신뢰도 72% 이상이면 학원 사진 갤러리에 자동 연계합니다.
- 시간표/가격표는 각각 `material_type=schedule/price`로 표시합니다. 이미지 내 텍스트/OCR이나 수업·가격 상세 데이터 생성은 하지 않습니다.
- 인물/얼굴, 로고·QR·아이콘, 발레와 무관, 판단 불가, 신뢰도 72% 미만은 자동 제외하고 갤러리에서도 제거합니다.
- 후보 기록과 AI 판단 정보는 DB에 남겨 복구 가능하도록 하며 원본 URL 자체를 삭제하지 않습니다.
- 향후 사진 수집 워커가 새 후보를 등록하면 자동으로 Vision 분류 후 갤러리 반영/제외를 처리합니다.
- 관리자 화면의 **전체 대기 사진 AI 자동 처리** 버튼은 기존 사진과 대기 후보를 전부 순차 처리합니다. 실패한 이미지는 대기 상태로 남아 재시도할 수 있습니다.

## 비용 및 제한
Gemini API를 사진 1장당 호출합니다. 전수 처리 시 API 사용량이 발생하므로 기존 사진 전수 작업은 관리자가 버튼을 눌러 시작합니다. 신규 사진은 수집 작업 때 순차 처리됩니다.
