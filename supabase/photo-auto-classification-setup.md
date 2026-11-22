# 사진 AI 자동 분류 및 공개 연계 설정

## 1회 설정
1. Supabase SQL Editor에서 아래 SQL을 순서대로 실행:
   - `studio_photo_review.sql` (후보 테이블)
   - `studio_photo_material_classification.sql` (자료 유형)
   - `studio_photo_auto_classification.sql` (AI 분류 필드)
   - `studio_photo_auto_publish.sql` (기존 갤러리·수집 사진을 후보로 등록)
   - `studio_photo_reprocess_existing.sql` (기존 사진과 후보의 AI 재분석을 위해 대기 상태로 초기화; **한 번만 실행**)
2. Google AI Studio에서 Gemini API Key를 발급해 Supabase Edge Function secret `GOOGLE_GEMINI_API_KEY`에 등록합니다.
3. **무료 사용만 허용:** Google AI Studio의 Gemini API Free Tier를 사용하고, Google Cloud 프로젝트에 유료 결제를 연결하지 마세요. 무료 쿼터 초과 시 분류는 실패/대기 상태로 남고 유료 API로 자동 전환하지 않습니다.
4. GitHub Actions `Deploy Balletmate Supabase Workers`가 Edge Function 배포를 수행합니다.

## 자동 운영 정책
- AI가 시각적 유형만 판별합니다. OCR이나 사진 속 문자를 읽지 않습니다.
- 발레 수업·시간표·가격표·포스터·로고 등 발레/학원 관련 이미지이며 신뢰도 **60% 이상**이면 관리자 검수 없이 갤러리에 자동 연결합니다.
- 시간표/가격표는 각각 `material_type=schedule/price`로 구분합니다. OCR 없이 사진 자체를 시간표/가격 자료로 연계하며, 상세 텍스트 정보는 생성하지 않습니다.
- 얼굴이 보이는 인물 사진, 발레와 무관한 이미지, 판단 불가, 신뢰도 60% 미만은 자동 제외합니다. 이미 갤러리에 있던 이미지도 제외 판단이면 갤러리 배열에서 제거합니다.
- 후보 기록과 AI 분류 결과는 복구·감사용으로 DB에 남깁니다. 이미지 URL 원본 자체를 삭제하는 것은 아닙니다.
- 공식 홈페이지 사진 수집 워커와 블로그 사진 수집 워커는 새 후보를 수집하면 Vision 분류를 순차 호출하여 자동 등록/제외합니다.
- 관리자 사진 메뉴의 **전체 사진 자동 분류·등록** 버튼으로 과거 사진과 대기 후보를 한 번에 순차 처리할 수 있습니다. 실패한 사진은 대기 상태로 남으므로 재시도할 수 있습니다.

## 무료 사용량/제한
- Gemini Vision API 호출은 사진 1장당 1회입니다. 무료 tier에는 요청/일일 제한이 있을 수 있습니다. 처리 속도는 순차로 제한합니다.
- 무료 쿼터를 초과하거나 이미지 fetch/분류에 실패하면 그 사진은 대기 상태로 남고, 유료 API 사용이나 자동 결제 전환은 없습니다.
- 분류 결과가 틀릴 수 있으므로 관리자 화면에서 제외된 사진/분류 결과를 조회할 수 있습니다.