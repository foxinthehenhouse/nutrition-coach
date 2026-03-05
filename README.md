# Nutrition Coach SMS Bot

A personal sports dietitian SMS bot built with FastAPI that integrates WHOOP biometric data, Supabase for storage, Mem0 for AI memory, and Claude for intelligent nutrition coaching — all delivered via Twilio SMS.

## Tech Stack

- **Python 3.11** + **FastAPI** — async web framework
- **Supabase** — PostgreSQL database with pgvector
- **Mem0** — persistent AI memory layer (pgvector backend)
- **Anthropic Claude** — nutrition coaching LLM
- **Twilio** — SMS send/receive
- **OpenAI Whisper** — voice note transcription
- **WHOOP** — biometric data (strain, recovery, sleep, HRV, workouts)

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check — returns `{"status": "ok"}` |
| `POST` | `/webhook/sms` | Twilio inbound SMS webhook (returns 200 immediately, processes async) |
| `POST` | `/webhook/whoop` | WHOOP event webhook (recovery, workout, sleep updates) |
| `GET` | `/auth/whoop` | Initiates WHOOP OAuth2 flow |
| `GET` | `/auth/whoop/callback` | Handles OAuth2 callback, stores tokens |
| `GET` | `/sync/whoop` | Fetches today's WHOOP data, upserts to DB |
| `POST` | `/sync/whoop/backfill` | Backfills WHOOP history (requires `X-Admin-Token` when `SYNC_ADMIN_TOKEN` is set) |
| `POST` | `/checkin/{period}` | Triggers scheduled check-in (morning/midday/evening/night) |
| `GET` | `/debug/webhook` | Debug endpoint to verify all services are connected |

## Conversation Flows

The bot uses a state machine stored in the `conversation_state` table:

### Morning Planning (triggered by recovery.updated webhook 5–10am or `/checkin/morning`)
1. Morning brief with recovery interpretation, HRV context, suggested effort level
2. "Training today?" → yes/no
3. If yes: "What and when?" → extracts training type and time
4. Generates full day meal plan with 4–5 meals timed around training
5. User confirms or requests changes → plan locked

### Midday Check-in (`/checkin/midday` at 12pm)
- Calories eaten vs pace target, protein tracking, gap analysis, lunch suggestion

### Evening Check-in (`/checkin/evening` at 6pm)
- Remaining calories, dinner adjustment suggestions, training adherence check

### Post-Workout (triggered by workout.updated webhook)
- Workout stats, recalculated remaining calories, specific 45-min recovery meal recommendation

### Night Summary (`/checkin/night` at 9pm)
- Full day recap: calories/macros vs targets, biggest win/gap, tomorrow prediction
- Weekly pattern analysis on Mondays, monthly on 1st of month

### Free Chat (default)
- Food logging, questions, advice — all with full context from WHOOP and food log

## Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/foxinthehenhouse/nutrition-coach.git
   cd nutrition-coach
   ```

2. Create a virtual environment and install dependencies:
   ```bash
   python3.11 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

3. Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

4. Run the server:
   ```bash
   uvicorn main:app --reload --port 8000
   ```

## Railway Deployment

### 1. Connect Repository

- Go to [railway.app](https://railway.app) and create a new project
- Select **Deploy from GitHub repo**
- Connect your GitHub account and select `foxinthehenhouse/nutrition-coach`

### 2. Configure Environment Variables

In the Railway dashboard, go to your service's **Variables** tab and add all keys from `.env.example`:

- `ANTHROPIC_API_KEY` — Anthropic API key for Claude
- `OPENAI_API_KEY` — OpenAI API key (used by Mem0 for embeddings)
- `TWILIO_ACCOUNT_SID` — Twilio account SID
- `TWILIO_AUTH_TOKEN` — Twilio auth token
- `TWILIO_PHONE_NUMBER` — Your Twilio phone number (e.g. +61489261773)
- `WHOOP_CLIENT_ID` — WHOOP developer app client ID
- `WHOOP_CLIENT_SECRET` — WHOOP developer app client secret
- `WHOOP_REDIRECT_URI` — OAuth callback URL (e.g. https://your-app.up.railway.app/auth/whoop/callback)
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_KEY` — Supabase service role key
- `SUPABASE_DB_HOST` — PostgreSQL connection string
- `SUPABASE_DB_PASSWORD` — Database password
- `OWNER_PHONE_NUMBER` — Your phone number for proactive messages (e.g. +61456301777)
- `SYNC_ADMIN_TOKEN` — optional token required for `POST /sync/whoop/backfill`

Railway automatically sets the `PORT` environment variable.

### 3. Deploy

Railway detects the `Procfile` and `runtime.txt` automatically:

- **Procfile**: `web: uvicorn main:app --host 0.0.0.0 --port $PORT`
- **Runtime**: Python 3.11.9

### 4. Run Database Migrations

Run the SQL in `migration.sql` against your Supabase database (SQL Editor in Supabase Dashboard), then run all files in `supabase/migrations/`.
Set timezone in the `settings` table so daily pacing aligns with local day boundaries:

```sql
insert into settings (key, value)
values ('timezone', 'Australia/Sydney')
on conflict (key) do update set value = excluded.value;
```

### 5. Configure Twilio Webhook

In Twilio Console → Phone Numbers → your number → Messaging:
- **Webhook URL**: `https://your-app.up.railway.app/webhook/sms`
- **Method**: POST

### 6. Connect WHOOP

Visit `https://your-app.up.railway.app/auth/whoop` to authorize the WHOOP integration.

### 7. Register WHOOP Webhooks

In the WHOOP Developer Dashboard, register your webhook:
- **URL**: `https://nutrition-coach-production-4678.up.railway.app/webhook/whoop`
- **Model version**: v2
- **Event types**: `workout.updated`, `recovery.updated`, `sleep.updated`

## n8n Schedule Triggers

Set up these scheduled HTTP requests in n8n (all times AEDT → UTC):

| Time (AEDT) | UTC | Endpoint | Method |
|-------------|-----|----------|--------|
| 12:00 PM | 1:00 AM | `/checkin/midday` | POST |
| 6:00 PM | 7:00 AM | `/checkin/evening` | POST |
| 9:00 PM | 10:00 AM | `/checkin/night` | POST |
| Every 5-15 min | - | `/sync/whoop` | GET |

Morning planning is triggered automatically by the `recovery.updated` WHOOP webhook (5-10am local). No cron needed.

For real-time activity-driven updates, ensure WHOOP webhooks are registered (workout.updated, recovery.updated, sleep.updated). Workouts trigger instant post-workout meal advice.
Recovery and sleep updates also trigger proactive behavior nudges (with cooldown throttling).

Monday 9am AEDT pattern analysis is triggered automatically by the night summary flow.

## Supabase Schema

Run `migration.sql` to create all tables. The schema includes:

- **settings** — key/value configuration
- **food_log** — daily food entries with full macros, micronutrients (iron, calcium, potassium, vitamin D, magnesium, zinc, B12), and per-ingredient component breakdowns
- **whoop_cache** — cached WHOOP biometric data per day (incl. workout details)
- **conversation_log** — SMS conversation history with flow tracking and source (text/voice)
- **whoop_tokens** — OAuth2 tokens for WHOOP API
- **daily_plans** — daily intentions, training plans, meal plans, macro targets
- **conversation_state** — state machine for multi-step conversation flows
- **pattern_summaries** — weekly and monthly trend analysis results
- **whoop_event_nudges** — per-event/day cooldown tracking for proactive WHOOP SMS

## WHOOP Backfill + Validation

Run a one-time backfill (example: 180 days, 7-day chunks):

```bash
curl -X POST "https://your-app.up.railway.app/sync/whoop/backfill?days=180&chunk_days=7" \
  -H "X-Admin-Token: $SYNC_ADMIN_TOKEN"
```

## Configurable Settings

Set these in the `settings` table (key/value):

| Key | Values | Description |
|-----|--------|-------------|
| `timezone` | IANA timezone (e.g. `Australia/Sydney`) | User-local day boundary for pacing |
| `tone` | `calm_professional`, `friendly`, `direct`, `coach` | Controls the coaching communication style |
| `goal_mode` | `maintenance`, `recomposition` | Calorie target adjustment mode |
| `dietary_preferences` | free text | Dietary restrictions or preferences |

## Repeat Meal Suggestions

At check-in points, the coach proactively suggests re-logging a meal from the previous day if the same meal type has not been logged yet today. Portion suggestions are adjusted based on current vs previous day activity levels.

## Micronutrient Tracking

The coach tracks and flags deficiencies in iron, calcium, potassium, vitamin D, magnesium, zinc, and B12, which are critical for testosterone and hematocrit support.

Operational validation checklist:
- `GET /sync/whoop` returns `status=synced` and current-day data
- `POST /sync/whoop/backfill` updates historical dates in `whoop_cache`
- Midday/evening checkpoints reflect local-day pace status (`behind/on_track/ahead`)
- WHOOP `workout.updated`, `sleep.updated`, and `recovery.updated` each trigger at most one nudge per cooldown window

## WHOOP Token Error Handling in n8n

If you use n8n to call the WHOOP API or `/sync/whoop`, wrap the WHOOP call with this error handler so transient token failures do not spam SMS alerts:

```javascript
// In your n8n Function node, before sending SMS:
if (whoopError && whoopError.includes('token')) {
  // Silently attempt refresh. Do NOT send SMS.
  // Only send SMS if refresh fails 3 consecutive times.
  const failCount = $workflow.staticData.whoopFailCount || 0;
  $workflow.staticData.whoopFailCount = failCount + 1;

  if (failCount < 3) {
    return []; // Stop execution, no SMS sent
  }
  // After 3 failures, send ONE alert (not one per trigger)
  $workflow.staticData.whoopFailCount = 0;
}
```

## Voice Note Support

The bot supports voice notes sent as audio MMS. When a voice note is received, it's automatically transcribed using OpenAI Whisper and processed exactly like a text message.

**Supported formats:** OGG, MP4, MP3, AMR, WAV, WebM

**How to test:**

1. On iPhone, open Messages and text your Twilio number
2. Press and hold the microphone icon in the message bar to record
3. Say something like "I just had two scrambled eggs, a piece of sourdough toast with butter, and a black coffee"
4. Release to send
5. You should receive a transcription confirmation and calorie estimate within 15-20 seconds

**Note:** Standard iMessage audio messages may not send as MMS to a Twilio number depending on carrier. If voice notes aren't being received, use WhatsApp connected to the same Twilio number, or use Wispr Flow to transcribe on-device before sending as text.

## Food Photo Logging

You can MMS a photo of your meal instead of typing. Claude vision analyzes the image and returns itemized nutrition estimates. Reply YES to log or describe corrections (e.g. "bigger portion of rice", "add a glass of milk", "no sauce on mine").

### Testing Food Photo Logging

1. Take a clear photo of your meal — good lighting, whole plate visible
2. MMS it directly to your Twilio number from iPhone Messages
3. Claude analyzes and responds with itemized estimates within 15 seconds
4. Reply YES to log or describe any corrections naturally
5. Corrections loop until you confirm with YES

**Examples of corrections:** "bigger portion of rice", "add a glass of milk", "no sauce on mine", "that was a large not medium"

**Tips for best accuracy:**

- Photograph from directly above (birds-eye) for best portion estimation
- Include a fork or familiar object in frame as a size reference
- Good lighting significantly improves ingredient identification
- For mixed dishes like stir fry or curry, a slight angle shot helps Claude see components
- If Claude seems uncertain, reply with the specific item it got wrong

For food photo analysis, the `conversation_state` table supports per-phone image confirmation flow. Run `supabase/migrations/20250228000000_food_photo_analysis.sql` if adding to an existing schema.
