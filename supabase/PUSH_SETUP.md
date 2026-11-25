# 푸시 알림 설정

푸시 알림 기능은 앱 코드, Supabase Edge Function, DB 트리거, Expo 프로젝트 연결이 모두 필요합니다.

## 1. SQL 실행

Supabase SQL Editor에서 `supabase/push_notifications_and_app_notices.sql` 전체를 실행합니다.
이 파일은 기기 토큰, 앱 공지사항, 찜한 학원 업데이트 트리거를 생성합니다.

## 2. Edge Function 비밀키 설정

1. 긴 임의 문자열을 생성합니다. 예: `openssl rand -hex 32`
2. Supabase Dashboard → Edge Functions → Secrets에 아래 값을 등록합니다.
   - Name: `PUSH_DISPATCH_SECRET`
   - Value: 방금 생성한 문자열
3. 같은 문자열을 아래 SQL의 placeholder에 넣어 한 번 실행합니다.

```sql
select vault.create_secret(
  'https://ykxvcqgdvifogahbbbwr.supabase.co/functions/v1/send-push',
  'balletmate_push_function_url'
);
select vault.create_secret(
  '여기에 PUSH_DISPATCH_SECRET과 동일한 문자열',
  'balletmate_push_dispatch_secret'
);
```

이 문자열은 공개 저장소나 앱 코드에 넣지 마세요.

## 3. Expo 프로젝트 연결

앱은 `Constants.easConfig.projectId` 또는 `expo.extra.eas.projectId`에서 EAS Project ID를 읽어 Expo Push Token을 등록합니다.
현재 `app.json`에는 EAS Project ID가 아직 없습니다. Expo 프로젝트를 EAS에 연결한 뒤 발급된 UUID를 `expo.extra.eas.projectId`에 넣고 새 네이티브 앱 빌드를 해야 합니다.

## 4. 공지사항

관리자 화면의 `공지사항` 탭에서 앱 공지를 등록·숨김·삭제할 수 있습니다. 새 공지를 등록하면 활성 사용자 중 공지 알림을 켠 사용자에게 푸시 발송을 요청합니다.

## 5. 찜한 학원 업데이트

학원 관리자가 공지, 가격표, 시간표를 등록하거나 수정하면 해당 학원을 찜한 사용자 중 해당 알림을 켠 사용자에게 푸시 발송을 요청합니다.
