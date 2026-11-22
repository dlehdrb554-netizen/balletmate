# 학원 사진 AI 자동 분류 설정

1. Supabase SQL Editor에서 `studio_photo_auto_classification.sql` 실행.
2. Google AI Studio에서 Gemini API key를 발급합니다.
3. Supabase Dashboard → Edge Functions → Secrets (또는 Project Settings → Edge Functions → Secrets)에서 `GOOGLE_GEMINI_API_KEY` 이름으로 등록합니다.
4. GitHub Actions의 `Deploy Balletmate Supabase Workers`가 `classify-studio-photo` 함수를 배포합니다. 이미 실패/완료한 run은 새 commit 이후 다시 실행됩니다.

관리자 사진 검토에서 **불러온 미분류 사진 AI 분석**을 누르면 현재 불러온 최대 12장씩 순차 분석합니다. 각 사진의 **AI 분석** 버튼으로 단건 재분석도 가능합니다. 순차 처리해 호출량을 제한합니다.

- OCR/문자 추출, 가격·시간표 내용 읽기, 데이터 자동 등록은 하지 않습니다. 시각적 레이아웃 유형만 분류합니다.
- 결과 유형: 발레 수업 사진 / 시간표 / 가격표 / 포스터 / 로고 / 인물 / 무관 / 판단 불가
- AI 분류는 필터링 보조용이며 자동 승인·삭제·앱 공개를 하지 않습니다.
- Gemini API 사용량과 무료/유료 한도는 Google 계정/프로젝트의 현재 조건에 따릅니다. 키를 등록하지 않으면 분류 API는 작동하지 않습니다.
