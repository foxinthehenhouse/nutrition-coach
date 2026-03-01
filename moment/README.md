# moment

Expo app with Expo Router, NativeWind, Gluestack UI, and Supabase.

## Setup

1. Install dependencies:
   ```bash
   cd moment && npm install
   ```

2. Copy `.env.example` to `.env` and fill in your Supabase credentials and `EXPO_PUBLIC_APP_URL` (your app URL for magic link redirects):
   ```bash
   cp .env.example .env
   ```

   For magic link auth, add your app URLs to Supabase: **Auth → URL Configuration → Redirect URLs** (e.g. `http://localhost:8081`, `https://your-app.up.railway.app`).

3. Start the development server:
   ```bash
   npx expo start
   ```

## Deployment

**Native (iOS/Android):**
```bash
npx eas build --platform all
```
Uses `eas.json` profiles: `development`, `preview`, `production`.

**Web (Railway):**
- Build: `npm run build` (outputs to `dist/`)
- Railway: Set root directory to `moment/`. Build runs `npm run build`, start uses Procfile to serve `dist/` on `$PORT`.

## Project structure

- `app/` - Expo Router file-based routes
  - `(auth)/` - Auth flow (index at `/`)
  - `(onboarding)/` - Onboarding flow
  - `(app)/` - Main app (home at `/home`)
- `lib/supabase.ts` - Supabase client with AsyncStorage persistence
