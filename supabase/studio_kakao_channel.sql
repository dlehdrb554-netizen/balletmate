-- Add a dedicated field for KakaoTalk channel links discovered from Kakao Place.
ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS kakao_channel_url text;

COMMENT ON COLUMN public.studios.kakao_channel_url IS
  'KakaoTalk channel URL discovered from the studio Kakao Place listing; not a verified website URL.';
