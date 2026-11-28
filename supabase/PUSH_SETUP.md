# 푸시 알림 설정

푸시 알림 기능은 앱 코드, Supabase Edge Function, DB 트리거, Expo 프로젝트 연결이 모두 필요합니다.

## 1. SQL 실행

Supabase SQL Editor에서 `supabase/push_notifications_and_app_notices.sql` 전체를 실행합니다.
이 파일은 기기 토큰, 앱 공지사항, 찜한 학원 업데이트 트리거를 생성합니다.\n\n추가로 `supabase/in_app_notifications.sql` 전체를 실행하세요. 개인별 알림함, 읽음 상태, 미확인 카운트 및 Realtime 구독 권한을 생성합니다. 기존 푸시 SQL 실행 후 실행하면 됩니다.

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
현재 `app.json`에 EAS Project ID가 설정되어 있습니다. 실제 EAS 프로젝트와 UUID가 일치하는지 확인하고, 알림 배지 기능을 반영하려면 새 네이티브 앱 빌드를 배포하세요.

## 4. 공지사항

관리자 화면의 `공지사항` 탭에서 앱 공지를 등록·숨김·삭제할 수 있습니다. 새 공지를 등록하면 활성 사용자 중 공지 알림을 켠 사용자에게 푸시 발송을 요청합니다.

## 5. 찜한 학원 업데이트

학원 관리자가 공지, 가격표, 시간표를 등록하거나 수정하면 해당 학원을 찜한 사용자 중 해당 알림을 켠 사용자에게 푸시 발송을 요청합니다.

## 6. 알림함 및 배지 동기화

- `user_notifications`에 사용자별 알림 이력과 `read_at`을 저장합니다.
- 앱 헤더의 종 아이콘은 미확인 알림 수를 표시하며, 99개 초과는 `99+`로 축약합니다.
- 알림을 개별 확인하거나 '모두 읽음'을 누르면 DB 읽음 상태와 앱 아이콘 배지가 갱신됩니다.
- 푸시를 눌러 앱을 열면 해당 알림을 읽음 처리하고 목적 화면으로 이동합니다.
- iOS 앱 아이콘 숫자는 푸시의 `badge` 값과 앱 실행 중 동기화로 갱신됩니다. Android 숫자/점 표시는 런처와 사용자 기기 설정에 따라 다를 수 있습니다.
