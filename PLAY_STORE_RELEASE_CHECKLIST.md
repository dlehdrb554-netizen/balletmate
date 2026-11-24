# Balletmate Google Play 출시 점검표

최종 업데이트: 2026-11-24

## 코드 반영 사항

- [x] 앱 내 회원 탈퇴 버튼 및 확인 절차
- [x] Supabase Edge Function 계정 삭제 처리
- [x] 외부 계정 삭제 요청 웹 페이지 (이메일 환경변수 설정 필요)
- [x] 커뮤니티 이용규칙 동의 강제 (게시글·댓글 등록 전)
- [x] 커뮤니티 게시글·댓글 신고
- [x] 사용자 차단 및 차단 사용자 콘텐츠 숨김
- [x] 관리자 커뮤니티 신고 검토·콘텐츠 삭제 화면
- [x] 앱 내 개인정보처리방침·이용약관 초안
- [x] 공개 개인정보처리방침 Edge Function 초안
- [x] 학원 정보 제보에 저작권/사진 삭제 요청 유형 추가
- [x] Android versionCode 1
- [x] Expo SDK 54 기본 Android target API 36 확인

## Supabase에서 실행할 SQL

아래 순서로 Supabase SQL Editor에서 실행한다.

1. `supabase/account_deletion_setup.sql`
2. `supabase/community_safety.sql` (기존 `community.sql`, `admin_security.sql` 적용 이후)
3. `supabase/studio_photo_rights_report.sql` (기존 `studio_user_reports.sql` 적용 이후)

Edge Function 배포 workflow가 `delete-account`, `privacy-policy`를 배포한다. GitHub Actions의 Supabase 배포가 성공했는지 확인한다.

## Supabase Edge Function Secrets

- `ACCOUNT_DELETION_CONTACT_EMAIL`: 실제 개인정보/탈퇴 요청을 받을 이메일
- `PRIVACY_POLICY_OPERATOR_NAME`: 실제 운영자 또는 사업자 표기명
- `PRIVACY_POLICY_DATA_REGION`: Supabase 프로젝트의 실제 리전명

이 값이 설정되지 않으면 공개 페이지에 미완료 안내가 표시되므로 스토어 제출 전에 반드시 채운다.

## Play Console 수동 작업

- [ ] 공개 개인정보처리방침 URL 등록:
  `https://ykxvcqgdvifogahbbbwr.supabase.co/functions/v1/privacy-policy`
- [ ] 외부 계정 삭제 URL 등록:
  `https://ykxvcqgdvifogahbbbwr.supabase.co/functions/v1/delete-account`
- [ ] Data safety 양식 실제 데이터 흐름에 맞춰 제출
- [ ] 콘텐츠 등급 설문 작성
- [ ] 앱 액세스 지침 및 심사용 테스트 계정 제공 (로그인 기능 심사 시)
- [ ] 스토어 설명·아이콘·스크린샷·연락처 등록
- [ ] 새 앱은 Android API 36 이상 대상 빌드 사용
- [ ] Android App Bundle(AAB) 서명키 구성 및 업로드

## Data safety 작성 시 확인할 데이터 후보

실제 Play Console 응답은 배포된 앱과 Supabase 설정을 최종 확인한 뒤 작성한다.

- 계정 식별자, 프로필 표시명, OAuth 제공자 정보 및 제공되는 이메일
- 위치: 주변 학원 검색 시 지도 범위 좌표가 Supabase 조회 요청에 포함됨
- 사진: 사용자가 선택해 공개 학원 갤러리에 업로드한 사진
- 사용자 생성 콘텐츠: 커뮤니티 게시글·댓글·신고·차단 정보
- 원장 관리 신청 정보 및 사업자 확인 자료 (해당 기능/기존 데이터가 실제 활성화된 경우)

## 출시 전 실제 테스트

- [ ] 신규 Google/Kakao 가입, 재로그인, 로그아웃
- [ ] 일반 회원 탈퇴 후 재로그인 불가 및 계정 관련 데이터 삭제 확인
- [ ] 원장 권한 보유 계정 탈퇴 시 권한 해제·공개 학원 자료 유지 확인
- [ ] 커뮤니티 신고 접수, 차단/숨김, 관리자 신고 조회 및 콘텐츠 삭제
- [ ] 학원 저작권/사진 삭제 제보와 관리자 처리
- [ ] 위치 권한 허용/거부 각각 지도 동작
- [ ] 사진 선택·업로드 및 갤러리 표시
- [ ] 지도·검색·학원 상세·가격·시간표·즐겨찾기 회귀 테스트
- [ ] 실제 기기에서 앱 실행·복귀·화면 전환 테스트
- [ ] 서명된 AAB 설치/업로드 테스트
