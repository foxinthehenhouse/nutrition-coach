# moment

Expo app with Expo Router, NativeWind, Gluestack UI, and Supabase.

## Setup

1. Install dependencies:
   ```bash
   cd moment && npm install
   ```

2. Copy `.env.example` to `.env` and fill in your Supabase credentials:
   ```bash
   cp .env.example .env
   ```

3. Start the development server:
   ```bash
   npx expo start
   ```

## Project structure

- `app/` - Expo Router file-based routes
  - `(auth)/` - Auth flow (index at `/`)
  - `(onboarding)/` - Onboarding flow
  - `(app)/` - Main app (home at `/home`)
- `lib/supabase.ts` - Supabase client with AsyncStorage persistence
