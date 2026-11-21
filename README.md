# Balletmate 🩰

Mobile-first ballet studio discovery app built with Expo / React Native.

## Prototype features
- Interactive map and sample studio markers
- Search by studio name, district, or class tag
- Filters: adult/kids, skill level, weekday/weekend, time of day, price ceiling, coupon
- Search within moved map viewport
- Current-location permission and map centering
- Map/list/favorites views
- Studio detail modal with sample class information
- Select up to three studios for comparison

> Studio names, locations, ratings, and prices are illustrative mock data and have not been verified.

## Local setup
- Node.js LTS
- `npm install`
- `npx expo start`
- Scan with Expo Go (matching SDK) or run a simulator

## Validation
GitHub Actions runs `npx tsc --noEmit` on pushes and pull requests. This repository has not yet been built or run on a physical Android/iOS device.

## Roadmap
- UX refinement across different phone sizes
- Structured class schedule, lesson lengths, and verified contact information
- Responsible real data sourcing and API/provider terms review
- Backend, caching, and server-side usage limits to protect free tiers

Do not commit API keys, access tokens, or private credentials.