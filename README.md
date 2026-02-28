# Nutrition Coach SMS Bot

A personal nutrition coaching SMS bot built with FastAPI that integrates WHOOP biometric data, Supabase for storage, Mem0 for AI memory, and Claude for intelligent coaching — all delivered via Twilio SMS.

## Tech Stack

- **Python 3.11** + **FastAPI** — async web framework
- **Supabase** — PostgreSQL database with pgvector
- **Mem0** — persistent AI memory layer (pgvector backend)
- **Anthropic Claude** — nutrition coaching LLM
- **Twilio** — SMS send/receive
- **WHOOP** — biometric data (strain, recovery, sleep, HRV)

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check — returns `{"status": "ok"}` |
| `POST` | `/webhook/sms` | Twilio inbound SMS webhook |
| `GET` | `/auth/whoop` | Initiates WHOOP OAuth2 flow |
| `GET` | `/auth/whoop/callback` | Handles OAuth2 callback, stores tokens |
| `GET` | `/sync/whoop` | Fetches today's WHOOP data, upserts to DB |
| `POST` | `/checkin` | Sends proactive meal check-in SMS |
| `POST` | `/summary` | Sends end-of-day nutrition summary SMS |

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

In the Railway dashboard, go to your service's **Variables** tab and add all keys from `.env.example` with their values:

- `ANTHROPIC_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
- `WHOOP_REDIRECT_URI`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_DB_HOST`
- `SUPABASE_DB_PASSWORD`
- `OWNER_PHONE_NUMBER`

Railway automatically sets the `PORT` environment variable.

### 3. Deploy

Railway will detect the `Procfile` and `runtime.txt` automatically:

- **Procfile**: `web: uvicorn main:app --host 0.0.0.0 --port $PORT`
- **Runtime**: Python 3.11.0

Push to the `main` branch or trigger a manual deploy in the Railway dashboard.

### 4. Configure Twilio Webhook

Once deployed, copy your Railway URL (e.g., `https://nutrition-coach-production-XXXX.up.railway.app`) and configure it in Twilio:

1. Go to **Twilio Console** → **Phone Numbers** → select your number
2. Under **Messaging**, set the webhook for incoming messages to:
   ```
   https://your-railway-url.up.railway.app/webhook/sms
   ```
   Method: `POST`

### 5. Connect WHOOP

Visit `https://your-railway-url.up.railway.app/auth/whoop` in your browser to authorize the WHOOP integration.

### 6. Set Up Cron Jobs (Optional)

Use Railway's cron service or an external scheduler to automate:

- **WHOOP sync**: `GET /sync/whoop` — every 30 minutes
- **Meal check-in**: `POST /checkin` — at 12:00 PM and 6:00 PM
- **Daily summary**: `POST /summary` — at 9:00 PM

## Supabase Schema

The following tables must exist in your Supabase project (they are not created by this application):

- **settings** — key/value configuration (calorie goals, strain thresholds)
- **food_log** — daily food entries with macros
- **whoop_cache** — cached WHOOP biometric data per day
- **conversation_log** — SMS conversation history
- **whoop_tokens** — OAuth2 tokens for WHOOP API

For food photo analysis, run the migration in `supabase/migrations/20250228000000_food_photo_analysis.sql` to add:

- **conversation_state** — tracks image confirmation flow per phone number
- **conversation_log** — `source` and `flow` columns
- **food_log** — `meal_type`, `fiber_g`, `sodium_mg`, `sugar_g` columns

## How It Works

1. You text the bot describing what you ate
2. The bot estimates calories and macros using Claude, referencing your WHOOP biometrics and running food totals
3. It logs the food, updates AI memory, and replies with your remaining calories for the day
4. Proactive check-ins and summaries keep you on track throughout the day

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
