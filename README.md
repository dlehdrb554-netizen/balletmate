# Balletmate 🩰

Mobile-first ballet studio finder (Expo / React Native).

## Prototype functionality
- Map markers, current-location permission and area re-search
- Search by studio name, area and tags
- Filters: adult/kids, skill, weekday/weekend, morning/afternoon/evening, price cap, coupons
- Map, list and favorites tabs
- Studio detail and class timetable view
- Up to 3 studio comparison
- Local favorite persistence

## Backend
Supabase integration is in place:
- Active studio listing filtered to the current map viewport (up to 300 records per request)
- Class and session schedules fetched only when detail is opened
- Public read policies; no client-side write access
- Demo mode if environment variables are absent
- Empty backend stays empty (does not misleadingly fall back to mock records)

Setup: see [Supabase setup](supabase/SETUP.md) and run [schema.sql](supabase/schema.sql) in Supabase SQL Editor. Copy `.env.example` to local `.env` and set the public URL and anon/publishable key. Never put a service-role key in the mobile app.

## Development
```sh
npm install
npx expo start
```
Use Expo Go or a simulator matching this Expo SDK. GitHub Actions is configured for TypeScript checks.

## Data integrity
Prototype studio records are mock examples. Do not publish copied listings without checking data-source permissions and verifying information. The schema tracks source and verification metadata and requires explicit active flags for publication.

## Next steps
- Admin-only data entry/editing interface
- Spatial/viewport query and pagination
- Real source data and import pipeline with permission review
- Account-based favorite sync, if needed
- More detailed schedule/price/coupon filters and responsive polish
