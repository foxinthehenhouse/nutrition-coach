import os
import re
import json
import hmac
import hashlib
import base64
import logging
import secrets
import asyncio
import subprocess
import tempfile
from datetime import datetime, timezone, date, time as dt_time, timedelta
from urllib.parse import urlencode

import httpx
import openai
import anthropic
import imageio_ffmpeg
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response, BackgroundTasks
from fastapi.responses import JSONResponse, RedirectResponse
from supabase import create_client, Client
from twilio.rest import Client as TwilioClient
from mem0 import Memory

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Nutrition Coach SMS Bot")


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error on {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": str(exc), "type": type(exc).__name__, "path": str(request.url.path)},
    )


# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER")
WHOOP_CLIENT_ID = os.getenv("WHOOP_CLIENT_ID")
WHOOP_CLIENT_SECRET = os.getenv("WHOOP_CLIENT_SECRET")
WHOOP_REDIRECT_URI = os.getenv("WHOOP_REDIRECT_URI")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_SECRET_KEY")
SUPABASE_DB_HOST = os.getenv("SUPABASE_DB_HOST")
SUPABASE_DB_PASSWORD = os.getenv("SUPABASE_DB_PASSWORD")
OWNER_PHONE_NUMBER = os.getenv("OWNER_PHONE_NUMBER")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

WHOOP_BASE_URL = "https://api.prod.whoop.com/developer"
WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth"
WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
WHOOP_SCOPES = "offline read:recovery read:cycles read:workout read:sleep read:profile read:body_measurement"

USER_ID = "kyle"

# ---------------------------------------------------------------------------
# Lazy-init clients
# ---------------------------------------------------------------------------

_supabase: Client | None = None
_twilio_client: TwilioClient | None = None
_claude_client: anthropic.Anthropic | None = None


def get_supabase() -> Client:
    global _supabase
    if _supabase is None:
        _supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _supabase


def get_twilio() -> TwilioClient:
    global _twilio_client
    if _twilio_client is None:
        _twilio_client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    return _twilio_client


def get_claude() -> anthropic.Anthropic:
    global _claude_client
    if _claude_client is None:
        _claude_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    return _claude_client


def _parse_db_url(url: str) -> dict:
    """Parse a PostgreSQL connection string, handling special chars in passwords."""
    if not url or not url.startswith("postgresql://"):
        return {}
    stripped = url[len("postgresql://"):]
    at_idx = stripped.rfind("@")
    if at_idx == -1:
        return {}
    userinfo = stripped[:at_idx]
    hostinfo = stripped[at_idx + 1:]
    colon_idx = userinfo.find(":")
    user = userinfo[:colon_idx] if colon_idx != -1 else userinfo
    password = userinfo[colon_idx + 1:] if colon_idx != -1 else ""
    slash_idx = hostinfo.find("/")
    host_port = hostinfo[:slash_idx] if slash_idx != -1 else hostinfo
    dbname = hostinfo[slash_idx + 1:] if slash_idx != -1 else "postgres"
    port_idx = host_port.rfind(":")
    host = host_port[:port_idx] if port_idx != -1 else host_port
    port = int(host_port[port_idx + 1:]) if port_idx != -1 else 5432
    return {"host": host, "port": port, "user": user, "password": password, "dbname": dbname}


def get_mem0() -> Memory:
    parsed = _parse_db_url(SUPABASE_DB_HOST)
    config = {
        "vector_store": {
            "provider": "pgvector",
            "config": {
                "host": parsed.get("host", "localhost"),
                "port": parsed.get("port", 5432),
                "dbname": parsed.get("dbname", "postgres"),
                "user": parsed.get("user", "postgres"),
                "password": parsed.get("password") or SUPABASE_DB_PASSWORD,
            },
        },
        "llm": {
            "provider": "anthropic",
            "config": {
                "api_key": ANTHROPIC_API_KEY,
                "model": "claude-sonnet-4-20250514",
            },
        },
        "embedder": {
            "provider": "openai",
            "config": {
                "api_key": OPENAI_API_KEY,
                "model": "text-embedding-3-small",
            },
        },
    }
    return Memory.from_config(config)


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_settings() -> dict:
    try:
        result = get_supabase().table("settings").select("*").execute()
        return {row["key"]: row["value"] for row in result.data}
    except Exception as e:
        logger.error(f"Failed to load settings: {e}")
        return {}


def get_today_food_log() -> tuple[list[dict], dict]:
    today_str = date.today().isoformat()
    result = get_supabase().table("food_log").select("*").eq("date", today_str).execute()
    rows = result.data or []
    totals = {
        "calories": sum(r.get("calories") or 0 for r in rows),
        "protein_g": sum(float(r.get("protein_g") or 0) for r in rows),
        "carbs_g": sum(float(r.get("carbs_g") or 0) for r in rows),
        "fat_g": sum(float(r.get("fat_g") or 0) for r in rows),
        "fiber_g": sum(float(r.get("fiber_g") or 0) for r in rows),
        "sodium_mg": sum(float(r.get("sodium_mg") or 0) for r in rows),
        "sugar_g": sum(float(r.get("sugar_g") or 0) for r in rows),
    }
    return rows, totals


def get_today_whoop_cache() -> dict | None:
    today_str = date.today().isoformat()
    result = get_supabase().table("whoop_cache").select("*").eq("date", today_str).execute()
    return result.data[0] if result.data else None


def get_today_daily_plan() -> dict | None:
    today_str = date.today().isoformat()
    result = get_supabase().table("daily_plans").select("*").eq("date", today_str).execute()
    return result.data[0] if result.data else None


def upsert_daily_plan(data: dict):
    data["date"] = date.today().isoformat()
    get_supabase().table("daily_plans").upsert(data, on_conflict="date").execute()


def get_conversation_state() -> dict:
    result = get_supabase().table("conversation_state").select("*").eq("id", 1).execute()
    if result.data:
        return result.data[0]
    default = {"id": 1, "flow": "free_chat", "step": 0, "context": {}}
    get_supabase().table("conversation_state").upsert(default).execute()
    return default


def set_conversation_state(flow: str, step: int = 0, context: dict | None = None):
    payload = {
        "id": 1,
        "flow": flow,
        "step": step,
        "context": context or {},
        "last_updated": datetime.now(timezone.utc).isoformat(),
    }
    get_supabase().table("conversation_state").upsert(payload).execute()


def log_food(meal_data: dict):
    now = datetime.now(timezone.utc)
    get_supabase().table("food_log").insert({
        "date": date.today().isoformat(),
        "time": now.strftime("%H:%M:%S"),
        "meal_type": meal_data.get("meal_type", ""),
        "description": meal_data.get("description", ""),
        "calories": meal_data.get("calories", 0),
        "protein_g": meal_data.get("protein_g", 0),
        "carbs_g": meal_data.get("carbs_g", 0),
        "fat_g": meal_data.get("fat_g", 0),
        "fiber_g": meal_data.get("fiber_g", 0),
        "sodium_mg": meal_data.get("sodium_mg", 0),
        "sugar_g": meal_data.get("sugar_g", 0),
        "source": meal_data.get("source", "sms"),
    }).execute()


def log_conversation(direction: str, message: str, flow: str | None = None, source: str | None = None):
    row = {"direction": direction, "message": message, "flow": flow}
    if source:
        row["source"] = source
    get_supabase().table("conversation_log").insert(row).execute()


def send_sms(to: str, body: str):
    get_twilio().messages.create(body=body, from_=TWILIO_PHONE_NUMBER, to=to)


# ---------------------------------------------------------------------------
# Meal tag parsing
# ---------------------------------------------------------------------------

def parse_meal_data(response_text: str) -> tuple[str, dict | None]:
    match = re.search(r"<meal>(.*?)</meal>", response_text, re.DOTALL)
    if match:
        try:
            meal_data = json.loads(match.group(1))
            clean_text = re.sub(r"\s*<meal>.*?</meal>\s*", "", response_text, flags=re.DOTALL).strip()
            return clean_text, meal_data
        except json.JSONDecodeError:
            logger.error("Failed to parse meal JSON from Claude response")
    return response_text, None


# ---------------------------------------------------------------------------
# Voice note transcription
# ---------------------------------------------------------------------------

AUDIO_EXTENSION_MAP = {
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/amr": "amr",
    "audio/wav": "wav",
    "audio/webm": "webm",
}


async def transcribe_audio(media_url: str, content_type: str) -> str:
    logger.info(f"Downloading audio: {media_url} (type={content_type})")
    async with httpx.AsyncClient(follow_redirects=True) as client:
        response = await client.get(
            media_url,
            auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
        )
        response.raise_for_status()
        audio_bytes = response.content
        actual_type = response.headers.get("content-type", content_type).split(";")[0].strip()
    logger.info(f"Downloaded {len(audio_bytes)} bytes (actual type={actual_type})")

    input_ext = AUDIO_EXTENSION_MAP.get(actual_type, AUDIO_EXTENSION_MAP.get(content_type, "dat"))
    input_path = None
    output_path = None

    try:
        with tempfile.NamedTemporaryFile(suffix=f".{input_ext}", delete=False) as f:
            f.write(audio_bytes)
            input_path = f.name
        output_path = input_path.rsplit(".", 1)[0] + ".mp3"

        result = subprocess.run(
            [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-i", input_path, "-f", "mp3", "-ac", "1", "-ar", "16000", output_path],
            capture_output=True, timeout=30,
        )
        if result.returncode != 0:
            logger.warning(f"ffmpeg conversion failed: {result.stderr.decode()[-300:]}")
            mp3_bytes = audio_bytes
            filename = f"audio.{input_ext}"
        else:
            with open(output_path, "rb") as f:
                mp3_bytes = f.read()
            filename = "audio.mp3"
            logger.info(f"Converted to MP3: {len(mp3_bytes)} bytes")
    finally:
        if input_path and os.path.exists(input_path):
            os.unlink(input_path)
        if output_path and os.path.exists(output_path):
            os.unlink(output_path)

    openai_client = openai.OpenAI(api_key=OPENAI_API_KEY)
    transcript = openai_client.audio.transcriptions.create(
        model="whisper-1",
        file=(filename, mp3_bytes, "audio/mpeg"),
        prompt="This is a meal description for nutrition tracking. The speaker may mention food names, quantities, portion sizes, and meal types.",
    )
    logger.info(f"Transcription result: {transcript.text}")
    return transcript.text


# ---------------------------------------------------------------------------
# Nutrition pacing
# ---------------------------------------------------------------------------

def check_pace(target_kcal: int, eaten_kcal: int, current_hour: int) -> str:
    if current_hour < 7:
        return "day_not_started"
    if current_hour > 20:
        return "window_closed"
    expected = target_kcal * (current_hour - 7) / 13
    if eaten_kcal < expected * 0.75:
        return "behind"
    if eaten_kcal > target_kcal * 1.15:
        return "ahead"
    return "on_track"


# ---------------------------------------------------------------------------
# WHOOP token management
# ---------------------------------------------------------------------------

async def get_whoop_token() -> str | None:
    result = get_supabase().table("whoop_tokens").select("*").eq("id", 1).execute()
    if not result.data:
        logger.error("No Whoop tokens found in database")
        return None
    token_row = result.data[0]
    expires_at_str = token_row.get("expires_at")
    if expires_at_str:
        expires_at = datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
        if (expires_at - datetime.now(timezone.utc)).total_seconds() < 300:
            logger.info("Whoop token expiring soon, refreshing...")
            new_token = await refresh_whoop_token(token_row.get("refresh_token"))
            if not new_token:
                try:
                    send_sms(OWNER_PHONE_NUMBER, "⚠️ WHOOP token refresh failed. Re-auth needed at /auth/whoop")
                except Exception:
                    pass
                return None
            return new_token
    return token_row["access_token"]


async def refresh_whoop_token(refresh_token: str) -> str | None:
    if not refresh_token:
        logger.error("No refresh token available")
        return None
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                WHOOP_TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id": WHOOP_CLIENT_ID,
                    "client_secret": WHOOP_CLIENT_SECRET,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            resp.raise_for_status()
            data = resp.json()
        expires_at = datetime.fromtimestamp(
            datetime.now(timezone.utc).timestamp() + data["expires_in"], tz=timezone.utc
        ).isoformat()
        token_row = {"id": 1, "access_token": data["access_token"], "expires_at": expires_at}
        if data.get("refresh_token"):
            token_row["refresh_token"] = data["refresh_token"]
        get_supabase().table("whoop_tokens").upsert(token_row).execute()
        logger.info("Whoop token refreshed successfully")
        return data["access_token"]
    except Exception as e:
        logger.error(f"Failed to refresh Whoop token: {e}")
        return None


# ---------------------------------------------------------------------------
# WHOOP sync
# ---------------------------------------------------------------------------

async def sync_whoop_today() -> dict:
    token = await get_whoop_token()
    if not token:
        return {}

    now = datetime.now(timezone.utc)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start = midnight.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    end = now.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    headers = {"Authorization": f"Bearer {token}"}

    whoop_data: dict = {}

    async with httpx.AsyncClient() as client:
        # Cycles
        try:
            resp = await client.get(
                f"{WHOOP_BASE_URL}/v2/cycle",
                params={"start": start, "end": end, "limit": 1},
                headers=headers,
            )
            resp.raise_for_status()
            for rec in resp.json().get("records", []):
                if rec.get("score_state") == "SCORED" and rec.get("score"):
                    whoop_data["strain_score"] = rec["score"].get("strain")
                    kj = rec["score"].get("kilojoule", 0)
                    whoop_data["calories_burned_kcal"] = round(kj / 4.184, 1) if kj else None
                    break
        except Exception as e:
            logger.error(f"Error fetching Whoop cycles: {e}")

        # Recovery
        try:
            resp = await client.get(
                f"{WHOOP_BASE_URL}/v2/recovery",
                params={"start": start, "end": end, "limit": 1},
                headers=headers,
            )
            resp.raise_for_status()
            for rec in resp.json().get("records", []):
                if rec.get("score_state") == "SCORED" and rec.get("score"):
                    whoop_data["recovery_score"] = rec["score"].get("recovery_score")
                    whoop_data["hrv_rmssd"] = rec["score"].get("hrv_rmssd_milli")
                    whoop_data["resting_heart_rate"] = rec["score"].get("resting_heart_rate")
                    break
        except Exception as e:
            logger.error(f"Error fetching Whoop recovery: {e}")

        # Sleep
        try:
            resp = await client.get(
                f"{WHOOP_BASE_URL}/v2/activity/sleep",
                params={"start": start, "end": end, "limit": 1},
                headers=headers,
            )
            resp.raise_for_status()
            for rec in resp.json().get("records", []):
                if rec.get("score_state") == "SCORED" and rec.get("score"):
                    whoop_data["sleep_performance_pct"] = rec["score"].get("sleep_performance_percentage")
                    s_start = rec.get("start")
                    s_end = rec.get("end")
                    if s_start and s_end:
                        s = datetime.fromisoformat(s_start.replace("Z", "+00:00"))
                        e = datetime.fromisoformat(s_end.replace("Z", "+00:00"))
                        whoop_data["sleep_hours"] = round((e - s).total_seconds() / 3600, 2)
                    break
        except Exception as e:
            logger.error(f"Error fetching Whoop sleep: {e}")

        # Workouts (most recent scored)
        try:
            resp = await client.get(
                f"{WHOOP_BASE_URL}/v2/activity/workout",
                params={"start": start, "end": end, "limit": 5},
                headers=headers,
            )
            resp.raise_for_status()
            for rec in resp.json().get("records", []):
                if rec.get("score_state") == "SCORED" and rec.get("score"):
                    whoop_data["workout_type"] = rec.get("sport_name")
                    whoop_data["workout_strain"] = rec["score"].get("strain")
                    kj = rec["score"].get("kilojoule", 0)
                    whoop_data["workout_kcal"] = round(kj / 4.184, 1) if kj else None
                    break
        except Exception as e:
            logger.error(f"Error fetching Whoop workouts: {e}")

    upsert_payload = {"date": date.today().isoformat(), "last_updated": now.isoformat()}
    for k, v in whoop_data.items():
        if v is not None:
            upsert_payload[k] = v
    get_supabase().table("whoop_cache").upsert(upsert_payload, on_conflict="date").execute()
    return whoop_data


async def fetch_workout_by_id(workout_id: str) -> dict | None:
    token = await get_whoop_token()
    if not token:
        return None
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{WHOOP_BASE_URL}/v2/activity/workout/{workout_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        logger.error(f"Error fetching workout {workout_id}: {e}")
        return None


# ---------------------------------------------------------------------------
# Calorie / macro targets
# ---------------------------------------------------------------------------

STRAIN_TARGETS = {
    "low":    {"calories": 2200, "protein_g": 150, "carbs_g": 200, "fat_g": 70},
    "normal": {"calories": 2500, "protein_g": 160, "carbs_g": 230, "fat_g": 75},
    "high":   {"calories": 2900, "protein_g": 175, "carbs_g": 280, "fat_g": 80},
    "monster": {"calories": 3100, "protein_g": 185, "carbs_g": 310, "fat_g": 85},
}


def get_strain_level(strain_score: float | None) -> str:
    if strain_score is None:
        return "normal"
    if strain_score >= 17:
        return "monster"
    if strain_score >= 13:
        return "high"
    if strain_score <= 7:
        return "low"
    return "normal"


def get_targets(strain_score: float | None, settings: dict) -> dict:
    level = get_strain_level(strain_score)
    targets = STRAIN_TARGETS[level].copy()
    goal_mode = settings.get("goal_mode", "maintenance")
    if goal_mode == "recomposition":
        targets["calories"] -= 175
    return targets


# ---------------------------------------------------------------------------
# Claude system prompt
# ---------------------------------------------------------------------------

def build_system_prompt(
    settings: dict,
    whoop_data: dict | None,
    food_rows: list[dict],
    food_totals: dict,
    memories: list,
    daily_plan: dict | None = None,
) -> str:
    strain = whoop_data.get("strain_score") if whoop_data else None
    targets = get_targets(strain, settings)
    remaining = targets["calories"] - food_totals["calories"]
    goal_mode = settings.get("goal_mode", "maintenance")
    dietary_prefs = settings.get("dietary_preferences", "none")
    current_hour = datetime.now(timezone.utc).hour
    pace = check_pace(targets["calories"], food_totals["calories"], current_hour)

    w = whoop_data or {}
    workout_type = w.get("workout_type", "none")
    workout_strain = w.get("workout_strain", "N/A")
    workout_kcal = w.get("workout_kcal", "N/A")

    food_lines = []
    for r in food_rows:
        food_lines.append(
            f"- {r.get('time', '??:??')} [{r.get('meal_type', '')}] {r.get('description', 'unknown')}: "
            f"{r.get('calories', 0)} kcal, {r.get('protein_g', 0)}g P, "
            f"{r.get('carbs_g', 0)}g C, {r.get('fat_g', 0)}g F, "
            f"{r.get('fiber_g', 0)}g fiber"
        )
    food_summary = "\n".join(food_lines) if food_lines else "No food logged yet today."

    meal_plan_str = "Not set"
    if daily_plan and daily_plan.get("meal_plan"):
        mp = daily_plan["meal_plan"]
        meal_plan_str = json.dumps(mp, indent=2) if isinstance(mp, (dict, list)) else str(mp)

    mem_text = "\n".join(m.get("memory", str(m)) for m in memories) if memories else "No memories yet."

    return f"""You are Kyle's personal sports dietitian — PhD-level expertise in performance nutrition, \
exercise physiology, and behavior change. You communicate via SMS so be concise, warm, \
and direct. No fluff. You know Kyle well and your tone reflects that — like a knowledgeable \
friend who happens to have a PhD, not a clinical robot.

KYLE'S BASELINE PROFILE:
BMR: ~1,700 kcal/day
90-day average burn: ~2,375 kcal/day
Goal mode: {goal_mode}
Dietary preferences: {dietary_prefs}
Health priorities: testosterone and hematocrit support — under-fueling is a bigger risk \
than over-fueling for Kyle specifically

STRAIN-BASED DAILY TARGETS:
Low strain (Strain ≤7): 2,200 kcal | Protein 150g | Carbs 200g | Fat 70g
Normal (Strain 8–12): 2,500 kcal | Protein 160g | Carbs 230g | Fat 75g
High strain (Strain ≥13): 2,900 kcal | Protein 175g | Carbs 280g | Fat 80g
Monster day (Strain 17+): 3,100 kcal — distribute surplus over next 2 days
If goal_mode = recomposition: reduce all calorie targets by 175 kcal

TODAY'S WHOOP DATA:
Date: {date.today().isoformat()}
Strain: {w.get('strain_score', 'N/A')} | Calories burned so far: {w.get('calories_burned_kcal', 'N/A')} kcal
Recovery: {w.get('recovery_score', 'N/A')}% | HRV: {w.get('hrv_rmssd', 'N/A')}ms | RHR: {w.get('resting_heart_rate', 'N/A')}bpm
Sleep performance: {w.get('sleep_performance_pct', 'N/A')}%
Latest workout: {workout_type} — {workout_strain} strain, {workout_kcal} kcal

TODAY'S NUTRITION:
Meal plan for today: {meal_plan_str}
Logged so far: {food_totals['calories']} kcal | Protein: {food_totals['protein_g']}g | \
Carbs: {food_totals['carbs_g']}g | Fat: {food_totals['fat_g']}g | Fiber: {food_totals['fiber_g']}g
Today's target: {targets['calories']} kcal | Remaining: {remaining} kcal
Nutrition pace: {pace} (on track / behind / ahead)

{food_summary}

RELEVANT MEMORIES:
{mem_text}

INSTRUCTIONS:
- Always think in terms of macro AND micronutrients — flag sodium, fiber, sugar when relevant
- When suggesting food changes, be specific and simple: "add 30g of almonds" not "eat more healthy fats"
- Reference Kyle's logged foods and preferences when making suggestions
- When you detect a recurring issue (e.g. low protein at lunch 3 days running), name it directly
- Append structured meal data after any food log in this exact format, on its own line:
  <meal>{{"meal_type": "lunch", "calories": 650, "protein_g": 45, "carbs_g": 60, "fat_g": 18, \
"fiber_g": 8, "sodium_mg": 420, "sugar_g": 12, "description": "chicken rice bowl with veg"}}</meal>
- Never make the <meal> tag visible in your response to the user — it's parsed silently"""


# ---------------------------------------------------------------------------
# Memory helpers
# ---------------------------------------------------------------------------

def mem0_search(query: str) -> list:
    try:
        memory = get_mem0()
        result = memory.search(query=query, user_id=USER_ID)
        return result if isinstance(result, list) else []
    except Exception as e:
        logger.error(f"Mem0 search failed: {e}")
        return []


def mem0_add(messages: list):
    try:
        memory = get_mem0()
        memory.add(messages=messages, user_id=USER_ID)
    except Exception as e:
        logger.error(f"Mem0 add failed: {e}")


# ---------------------------------------------------------------------------
# Claude call helper
# ---------------------------------------------------------------------------

def call_claude(system_prompt: str, user_message: str) -> str:
    response = get_claude().messages.create(
        model="claude-opus-4-6",
        max_tokens=1024,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )
    return response.content[0].text


def build_context_and_call(user_message: str, extra_mem_query: str | None = None) -> str:
    """Full context build + Claude call. Returns raw Claude response."""
    settings = get_settings()
    food_rows, food_totals = get_today_food_log()
    whoop_data = get_today_whoop_cache()
    daily_plan = get_today_daily_plan()
    query = extra_mem_query or user_message
    memories = mem0_search(query)
    system_prompt = build_system_prompt(settings, whoop_data, food_rows, food_totals, memories, daily_plan)
    return call_claude(system_prompt, user_message)


def process_and_send(claude_response: str, to: str, flow: str | None = None) -> str:
    """Parse meal tags, log food, send SMS, log conversation. Returns clean message."""
    clean_message, meal_data = parse_meal_data(claude_response)
    if meal_data:
        try:
            log_food(meal_data)
        except Exception as e:
            logger.error(f"Failed to log food: {e}")
    try:
        send_sms(to=to, body=clean_message)
    except Exception as e:
        logger.error(f"Failed to send SMS: {e}")
    try:
        log_conversation("outbound", claude_response, flow=flow)
    except Exception as e:
        logger.error(f"Failed to log conversation: {e}")
    return clean_message


# ---------------------------------------------------------------------------
# Pattern analysis
# ---------------------------------------------------------------------------

def analyze_patterns(period: str = "weekly") -> dict:
    days = 7 if period == "weekly" else 30
    end_date = date.today()
    start_date = end_date - timedelta(days=days)

    food_result = (
        get_supabase().table("food_log").select("*")
        .gte("date", start_date.isoformat())
        .lte("date", end_date.isoformat())
        .execute()
    )
    whoop_result = (
        get_supabase().table("whoop_cache").select("*")
        .gte("date", start_date.isoformat())
        .lte("date", end_date.isoformat())
        .execute()
    )
    plan_result = (
        get_supabase().table("daily_plans").select("*")
        .gte("date", start_date.isoformat())
        .lte("date", end_date.isoformat())
        .execute()
    )

    food_rows = food_result.data or []
    whoop_rows = whoop_result.data or []
    plan_rows = plan_result.data or []

    daily_cals = {}
    daily_protein = {}
    food_counts = {}
    for row in food_rows:
        d = row.get("date", "")
        daily_cals[d] = daily_cals.get(d, 0) + (row.get("calories") or 0)
        daily_protein[d] = daily_protein.get(d, 0) + float(row.get("protein_g") or 0)
        desc = row.get("description", "").lower()
        meal_type = row.get("meal_type", "unknown")
        key = f"{meal_type}:{desc}"
        food_counts[key] = food_counts.get(key, 0) + 1

    total_days = len(set(daily_cals.keys())) or 1
    avg_calories = sum(daily_cals.values()) / total_days
    avg_protein = sum(daily_protein.values()) / total_days

    protein_target_days = sum(1 for p in daily_protein.values() if p >= 150)
    protein_consistency = round(protein_target_days / total_days * 100, 1)

    hvr_on_good_protein = []
    hvr_on_low_protein = []
    whoop_by_date = {r["date"]: r for r in whoop_rows}
    for d, protein in daily_protein.items():
        next_day = (date.fromisoformat(d) + timedelta(days=1)).isoformat()
        if next_day in whoop_by_date and whoop_by_date[next_day].get("hrv_rmssd"):
            hrv = float(whoop_by_date[next_day]["hrv_rmssd"])
            if protein >= 150:
                hvr_on_good_protein.append(hrv)
            else:
                hvr_on_low_protein.append(hrv)

    training_planned = sum(1 for p in plan_rows if p.get("training_planned"))
    plan_confirmed = sum(1 for p in plan_rows if p.get("plan_confirmed"))

    top_foods = sorted(food_counts.items(), key=lambda x: -x[1])[:10]

    recovery_scores = [float(r["recovery_score"]) for r in whoop_rows if r.get("recovery_score")]
    avg_recovery = round(sum(recovery_scores) / len(recovery_scores), 1) if recovery_scores else None

    summary = {
        "period": period,
        "period_start": start_date.isoformat(),
        "period_end": end_date.isoformat(),
        "days_with_data": total_days,
        "avg_calories": round(avg_calories),
        "avg_protein_g": round(avg_protein, 1),
        "protein_consistency_pct": protein_consistency,
        "avg_hrv_good_protein": round(sum(hvr_on_good_protein) / len(hvr_on_good_protein), 1) if hvr_on_good_protein else None,
        "avg_hrv_low_protein": round(sum(hvr_on_low_protein) / len(hvr_on_low_protein), 1) if hvr_on_low_protein else None,
        "training_sessions_planned": training_planned,
        "plans_confirmed": plan_confirmed,
        "avg_recovery": avg_recovery,
        "top_foods": top_foods,
    }

    get_supabase().table("pattern_summaries").insert({
        "period_type": period,
        "period_start": start_date.isoformat(),
        "period_end": end_date.isoformat(),
        "summary": summary,
    }).execute()

    return summary


# ---------------------------------------------------------------------------
# Flow handlers
# ---------------------------------------------------------------------------

async def handle_morning_planning(step: int, context: dict, user_message: str = "") -> None:
    if step == 0:
        await sync_whoop_today()
        memories = mem0_search("training schedule preferences typical morning routine")
        settings = get_settings()
        whoop_data = get_today_whoop_cache()
        food_rows, food_totals = get_today_food_log()
        system_prompt = build_system_prompt(settings, whoop_data, food_rows, food_totals, memories)
        claude_msg = call_claude(
            system_prompt,
            "Generate Kyle's morning brief. Include: recovery score interpretation, HRV context "
            "vs his baseline, sleep quality, and a suggested effort level for today "
            "(Easy / Moderate / Hard / Rest) with a one-sentence rationale. Then ask one question: "
            "'Training today?' Keep it under 300 characters total. Be direct and warm."
        )
        process_and_send(claude_msg, OWNER_PHONE_NUMBER, flow="morning_planning")
        set_conversation_state("morning_planning", step=1, context=context)

    elif step == 1:
        classify_response = call_claude(
            "You are a classifier. Reply ONLY with one word: yes, no, or maybe.",
            f"Classify this response as yes/no/maybe regarding training today: '{user_message}'"
        )
        intent = classify_response.strip().lower()
        if "no" in intent or "rest" in intent:
            context["training_planned"] = False
            upsert_daily_plan({"training_planned": False})
            set_conversation_state("morning_planning", step=3, context=context)
            await handle_morning_planning(3, context)
        else:
            send_sms(OWNER_PHONE_NUMBER, "What and when?")
            log_conversation("outbound", "What and when?", flow="morning_planning")
            set_conversation_state("morning_planning", step=2, context=context)

    elif step == 2:
        extract_response = call_claude(
            'Extract training details. Reply ONLY with JSON: {"type": "...", "time": "..."}',
            f"Extract the training type and time from: '{user_message}'"
        )
        try:
            training = json.loads(extract_response.strip())
        except json.JSONDecodeError:
            match = re.search(r'\{.*\}', extract_response, re.DOTALL)
            training = json.loads(match.group()) if match else {"type": user_message, "time": "unknown"}

        context["training_type"] = training.get("type", "")
        context["training_time"] = training.get("time", "")
        context["training_planned"] = True
        upsert_daily_plan({
            "training_planned": True,
            "training_type": context["training_type"],
            "training_time": context["training_time"],
        })
        set_conversation_state("morning_planning", step=3, context=context)
        await handle_morning_planning(3, context)

    elif step == 3:
        memories = mem0_search("food preferences typical meals weekly_pattern")
        settings = get_settings()
        whoop_data = get_today_whoop_cache()
        food_rows, food_totals = get_today_food_log()
        daily_plan = get_today_daily_plan()
        strain = whoop_data.get("strain_score") if whoop_data else None
        targets = get_targets(strain, settings)
        recovery = whoop_data.get("recovery_score", "N/A") if whoop_data else "N/A"
        effort = context.get("confirmed_effort_level", "Moderate")
        t_type = context.get("training_type", "none")
        t_time = context.get("training_time", "N/A")
        training_planned = context.get("training_planned", False)

        system_prompt = build_system_prompt(settings, whoop_data, food_rows, food_totals, memories, daily_plan)
        training_info = f"training {t_type} at {t_time}" if training_planned else "no training planned"
        claude_msg = call_claude(
            system_prompt,
            f"Generate a full day meal plan for Kyle given: recovery {recovery}, effort level {effort}, "
            f"{training_info}, targets {targets['calories']} kcal / {targets['protein_g']}g P / "
            f"{targets['carbs_g']}g C / {targets['fat_g']}g F. "
            f"Structure as 4-5 meals timed around his training window. "
            f"Use foods he's logged before where possible (from memories). "
            f"Each meal should show kcal, P/C/F. Format for SMS readability. "
            f"End by asking him to confirm or suggest changes."
        )
        clean = process_and_send(claude_msg, OWNER_PHONE_NUMBER, flow="morning_planning")

        try:
            meal_plan_json = {"raw_plan": clean}
            upsert_daily_plan({
                "meal_plan": meal_plan_json,
                "calorie_target": targets["calories"],
                "protein_target_g": targets["protein_g"],
                "carb_target_g": targets["carbs_g"],
                "fat_target_g": targets["fat_g"],
                "recovery_score": whoop_data.get("recovery_score") if whoop_data else None,
                "hrv_rmssd": whoop_data.get("hrv_rmssd") if whoop_data else None,
                "resting_heart_rate": whoop_data.get("resting_heart_rate") if whoop_data else None,
                "sleep_performance_pct": whoop_data.get("sleep_performance_pct") if whoop_data else None,
                "suggested_effort_level": effort,
            })
        except Exception as e:
            logger.error(f"Failed to save meal plan: {e}")

        set_conversation_state("morning_planning", step=4, context=context)

    elif step == 4:
        classify = call_claude(
            "You are a classifier. Reply ONLY with: confirm or change.",
            f"Is this user confirming a plan or requesting changes? '{user_message}'"
        )
        if "confirm" in classify.strip().lower():
            upsert_daily_plan({"plan_confirmed": True})
            send_sms(OWNER_PHONE_NUMBER, "Plan locked. I'll check in at noon. 💪")
            log_conversation("outbound", "Plan locked. I'll check in at noon. 💪", flow="morning_planning")
            set_conversation_state("free_chat", step=0)
        else:
            memories = mem0_search("food preferences")
            settings = get_settings()
            whoop_data = get_today_whoop_cache()
            food_rows, food_totals = get_today_food_log()
            daily_plan = get_today_daily_plan()
            system_prompt = build_system_prompt(settings, whoop_data, food_rows, food_totals, memories, daily_plan)
            claude_msg = call_claude(
                system_prompt,
                f"Kyle wants changes to his meal plan. His request: '{user_message}'. "
                f"Regenerate the affected meals, keeping the rest. Show updated plan. "
                f"Ask him to confirm again."
            )
            clean = process_and_send(claude_msg, OWNER_PHONE_NUMBER, flow="morning_planning")
            try:
                upsert_daily_plan({"meal_plan": {"raw_plan": clean}})
            except Exception as e:
                logger.error(f"Failed to update meal plan: {e}")


async def handle_midday_checkin() -> str:
    await sync_whoop_today()
    memories = mem0_search("lunch preferences")
    settings = get_settings()
    food_rows, food_totals = get_today_food_log()
    whoop_data = get_today_whoop_cache()
    daily_plan = get_today_daily_plan()
    system_prompt = build_system_prompt(settings, whoop_data, food_rows, food_totals, memories, daily_plan)

    strain = whoop_data.get("strain_score") if whoop_data else None
    targets = get_targets(strain, settings)
    current_hour = datetime.now(timezone.utc).hour
    pace_target = targets["calories"] * max(0, current_hour - 7) / 13

    claude_msg = call_claude(
        system_prompt,
        f"Generate Kyle's midday check-in. Reference his morning plan. Show: calories eaten "
        f"({food_totals['calories']}) vs pace target ({round(pace_target)}), protein tracking "
        f"({food_totals['protein_g']}g / {targets['protein_g']}g). Identify the most important "
        f"gap right now. Suggest one specific adjustment to lunch based on where he's at. "
        f"If he appears to have skipped breakfast, flag it gently. Ask if he's logged everything. "
        f"Under 320 characters."
    )
    return process_and_send(claude_msg, OWNER_PHONE_NUMBER, flow="midday_checkin")


async def handle_evening_checkin() -> str:
    await sync_whoop_today()
    memories = mem0_search("dinner preferences evening eating patterns")
    settings = get_settings()
    food_rows, food_totals = get_today_food_log()
    whoop_data = get_today_whoop_cache()
    daily_plan = get_today_daily_plan()
    system_prompt = build_system_prompt(settings, whoop_data, food_rows, food_totals, memories, daily_plan)

    strain = whoop_data.get("strain_score") if whoop_data else None
    targets = get_targets(strain, settings)
    remaining = targets["calories"] - food_totals["calories"]

    claude_msg = call_claude(
        system_prompt,
        f"Generate Kyle's 6pm check-in. Show calories remaining ({remaining}) vs target "
        f"({targets['calories']}). Assess if he's on track. If behind: suggest a specific dinner "
        f"adjustment to close the gap (e.g. 'add 40g extra rice and another chicken breast'). "
        f"If ahead: suggest a lighter dinner option. Check if any meals appear unlogged. "
        f"Ask if he trained as planned. Under 320 characters."
    )
    return process_and_send(claude_msg, OWNER_PHONE_NUMBER, flow="evening_checkin")


async def handle_post_workout(workout_data: dict | None = None) -> str:
    daily_plan = get_today_daily_plan()
    whoop_data = get_today_whoop_cache()
    memories = mem0_search("post-workout nutrition habits")
    settings = get_settings()
    food_rows, food_totals = get_today_food_log()
    system_prompt = build_system_prompt(settings, whoop_data, food_rows, food_totals, memories, daily_plan)

    w = workout_data or whoop_data or {}
    sport = w.get("workout_type") or w.get("sport_name", "workout")
    w_strain = w.get("workout_strain") or w.get("strain", "N/A")
    w_kcal = w.get("workout_kcal", "N/A")
    total_burn = whoop_data.get("calories_burned_kcal", "N/A") if whoop_data else "N/A"

    strain = whoop_data.get("strain_score") if whoop_data else None
    targets = get_targets(strain, settings)
    remaining = targets["calories"] - food_totals["calories"]

    claude_msg = call_claude(
        system_prompt,
        f"Generate a post-workout message for Kyle. He just completed {sport} — {w_strain} strain, "
        f"{w_kcal} kcal burned. His total burn today is now {total_burn}. "
        f"Remaining calories: {remaining}. Tell him exactly what to eat in the next 45 minutes "
        f"(specific foods, grams of protein and carbs). Reference what he usually eats post-workout "
        f"if known from memories. Ask what he had. Under 300 characters."
    )
    return process_and_send(claude_msg, OWNER_PHONE_NUMBER, flow="post_workout")


async def handle_night_summary() -> str:
    await sync_whoop_today()
    memories = mem0_search("weekly_pattern monthly_pattern")
    settings = get_settings()
    food_rows, food_totals = get_today_food_log()
    whoop_data = get_today_whoop_cache()
    daily_plan = get_today_daily_plan()
    system_prompt = build_system_prompt(settings, whoop_data, food_rows, food_totals, memories, daily_plan)

    strain = whoop_data.get("strain_score") if whoop_data else None
    targets = get_targets(strain, settings)

    claude_msg = call_claude(
        system_prompt,
        f"Generate Kyle's daily summary. Include: calories in ({food_totals['calories']}) vs target "
        f"({targets['calories']}), protein ({food_totals['protein_g']}g) / carbs ({food_totals['carbs_g']}g) / "
        f"fat ({food_totals['fat_g']}g) vs goals, fiber ({food_totals['fiber_g']}g) and sodium "
        f"({food_totals['sodium_mg']}mg) if notable. Compare what he planned vs what actually happened. "
        f"Name the single biggest win and single biggest gap today. Give one behavioral recommendation "
        f"for tomorrow. Based on today's strain ({strain}) and nutrition, predict tomorrow's recovery "
        f"range. If you notice this gap has appeared 3+ times this week (check memories), name the "
        f"pattern directly. Under 400 characters."
    )
    clean = process_and_send(claude_msg, OWNER_PHONE_NUMBER, flow="night_summary")

    mem0_add([
        {"role": "user", "content": f"Day summary {date.today().isoformat()}: ate {food_totals['calories']} kcal, "
         f"{food_totals['protein_g']}g protein, strain {strain}"},
        {"role": "assistant", "content": claude_msg},
    ])

    today = date.today()
    if today.weekday() == 0:
        try:
            summary = analyze_patterns(period="weekly")
            mem0_add([{"role": "assistant", "content": f"weekly_pattern: {json.dumps(summary)}"}])
        except Exception as e:
            logger.error(f"Weekly pattern analysis failed: {e}")
    if today.day == 1:
        try:
            summary = analyze_patterns(period="monthly")
            mem0_add([{"role": "assistant", "content": f"monthly_pattern: {json.dumps(summary)}"}])
        except Exception as e:
            logger.error(f"Monthly pattern analysis failed: {e}")

    return clean


# ---------------------------------------------------------------------------
# WHOOP webhook verification
# ---------------------------------------------------------------------------

def verify_whoop_signature(raw_body: bytes, timestamp: str, signature: str) -> bool:
    if not WHOOP_CLIENT_SECRET:
        logger.warning("WHOOP_CLIENT_SECRET not set, skipping webhook verification")
        return True
    message = timestamp.encode() + raw_body
    expected = base64.b64encode(
        hmac.new(WHOOP_CLIENT_SECRET.encode(), message, hashlib.sha256).digest()
    ).decode()
    return hmac.compare_digest(expected, signature)


# ---------------------------------------------------------------------------
# Background task processors
# ---------------------------------------------------------------------------

async def process_sms_webhook(
    incoming_message: str,
    from_number: str,
    num_media: int = 0,
    media_content_type: str = "",
    media_url: str = "",
):
    """Process inbound SMS in the background (including transcription)."""
    try:
        source = "text"
        transcription_note = None

        if num_media > 0 and media_content_type.startswith("audio/"):
            try:
                logger.info(f"Starting voice transcription for {from_number}: url={media_url} type={media_content_type}")
                transcribed_text = await transcribe_audio(media_url, media_content_type)
                transcription_note = f"[Voice note transcribed: '{transcribed_text}']"
                incoming_message = transcribed_text
                source = "voice"
                logger.info(f"Voice note from {from_number} transcribed: {transcribed_text}")
            except Exception as e:
                logger.error(f"Voice transcription failed: {type(e).__name__}: {e}", exc_info=True)
                try:
                    send_sms(to=from_number, body=f"Couldn't transcribe voice note: {str(e)[:120]}. Try text instead.")
                except Exception as sms_err:
                    logger.error(f"Failed to send transcription error SMS: {sms_err}")
                return

        elif num_media > 0 and media_content_type.startswith("image/"):
            incoming_message = "The user sent a photo — ask them to describe the meal in text or voice for now."

        elif num_media > 0 and media_content_type:
            try:
                send_sms(to=from_number, body="I can only process voice notes and text right now. Describe your meal by voice or text.")
            except Exception as e:
                logger.error(f"Failed to send unsupported media SMS: {e}")
            return

        if not incoming_message:
            logger.warning(f"No message content from {from_number}, skipping")
            return

        log_msg = f"[Voice]: {incoming_message}" if source == "voice" else incoming_message
        try:
            log_conversation("inbound", log_msg, flow=None, source=source)
        except Exception as e:
            logger.error(f"Failed to log inbound: {e}")

        claude_input = incoming_message
        if transcription_note:
            claude_input = (
                "[This message was transcribed from a voice note. The user spoke naturally "
                "so interpret it generously — 'I just had a big bowl of pasta with meat sauce "
                "and some garlic bread' should be parsed as a full meal entry, not a question.] "
                + incoming_message
            )

        state = get_conversation_state()
        flow = state.get("flow", "free_chat")
        step = state.get("step", 0)
        context = state.get("context") or {}

        if flow == "morning_planning" and step > 0:
            await handle_morning_planning(step, context, user_message=claude_input)
            mem0_add([{"role": "user", "content": incoming_message}])
            return

        try:
            await sync_whoop_today()
        except Exception as e:
            logger.error(f"Whoop sync failed (continuing): {e}")

        claude_response = build_context_and_call(claude_input)
        clean_message = process_and_send(claude_response, from_number, flow="free_chat")

        try:
            log_conversation("inbound", log_msg, flow="free_chat", source=source)
        except Exception as e:
            logger.error(f"Failed to log conversation: {e}")

        mem0_add([
            {"role": "user", "content": incoming_message},
            {"role": "assistant", "content": claude_response},
        ])
    except Exception as e:
        logger.error(f"SMS processing error: {e}", exc_info=True)


async def process_whoop_webhook(payload: dict):
    """Process WHOOP webhook event in the background."""
    try:
        event_type = payload.get("type", "")
        trace_id = payload.get("trace_id", "")
        event_id = payload.get("id", "")

        if trace_id:
            existing = (
                get_supabase().table("conversation_log").select("id")
                .eq("message", f"whoop_trace:{trace_id}").execute()
            )
            if existing.data:
                logger.info(f"Duplicate WHOOP webhook trace_id: {trace_id}")
                return
            log_conversation("system", f"whoop_trace:{trace_id}", flow="whoop_webhook")

        if event_type == "recovery.updated":
            await sync_whoop_today()
            now = datetime.now(timezone.utc)
            hour = now.hour
            if 5 <= hour <= 10:
                await handle_morning_planning(0, {})

        elif event_type == "workout.updated":
            workout = await fetch_workout_by_id(event_id) if event_id else None
            if workout and workout.get("score_state") == "SCORED" and workout.get("score"):
                kj = workout["score"].get("kilojoule", 0)
                workout_info = {
                    "workout_type": workout.get("sport_name"),
                    "workout_strain": workout["score"].get("strain"),
                    "workout_kcal": round(kj / 4.184, 1) if kj else None,
                }
                now = datetime.now(timezone.utc)
                get_supabase().table("whoop_cache").upsert({
                    "date": date.today().isoformat(),
                    "workout_type": workout_info["workout_type"],
                    "workout_strain": workout_info["workout_strain"],
                    "workout_kcal": workout_info["workout_kcal"],
                    "last_updated": now.isoformat(),
                }, on_conflict="date").execute()
                await handle_post_workout(workout_info)

        elif event_type == "sleep.updated":
            await sync_whoop_today()

    except Exception as e:
        logger.error(f"WHOOP webhook processing error: {e}", exc_info=True)


# ---------------------------------------------------------------------------
# OAuth state storage
# ---------------------------------------------------------------------------

_oauth_states: set[str] = set()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
async def root():
    return RedirectResponse(url="/auth/whoop")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/auth/whoop")
async def auth_whoop():
    state = secrets.token_urlsafe(32)
    _oauth_states.add(state)
    params = {
        "client_id": WHOOP_CLIENT_ID,
        "redirect_uri": WHOOP_REDIRECT_URI,
        "response_type": "code",
        "scope": WHOOP_SCOPES,
        "state": state,
    }
    return RedirectResponse(url=f"{WHOOP_AUTH_URL}?{urlencode(params)}")


@app.get("/auth/whoop/callback")
async def auth_whoop_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
):
    if error:
        logger.error(f"WHOOP OAuth error: {error} — {error_description}")
        return JSONResponse(status_code=400, content={"error": error, "description": error_description})
    if not code:
        return JSONResponse(status_code=400, content={"error": "No authorization code received from WHOOP"})
    if state and state in _oauth_states:
        _oauth_states.discard(state)

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                WHOOP_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": WHOOP_REDIRECT_URI,
                    "client_id": WHOOP_CLIENT_ID,
                    "client_secret": WHOOP_CLIENT_SECRET,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if resp.status_code != 200:
                logger.error(f"WHOOP token exchange failed: {resp.status_code} {resp.text}")
                return JSONResponse(status_code=502, content={
                    "error": "Token exchange failed",
                    "whoop_status": resp.status_code,
                    "whoop_response": resp.text,
                })
            data = resp.json()
    except Exception as e:
        logger.error(f"WHOOP token exchange request failed: {e}")
        return JSONResponse(status_code=502, content={"error": f"Token exchange request failed: {str(e)}"})

    try:
        expires_in = data.get("expires_in", 3600)
        expires_at = datetime.fromtimestamp(
            datetime.now(timezone.utc).timestamp() + expires_in, tz=timezone.utc
        ).isoformat()
        token_row = {"id": 1, "access_token": data["access_token"], "expires_at": expires_at}
        if data.get("refresh_token"):
            token_row["refresh_token"] = data["refresh_token"]
        get_supabase().table("whoop_tokens").upsert(token_row).execute()
    except Exception as e:
        logger.error(f"Failed to store WHOOP tokens in Supabase: {e}")
        return JSONResponse(status_code=500, content={"error": f"Failed to store tokens: {str(e)}"})

    return {"status": "connected", "message": "Whoop OAuth2 tokens stored successfully"}


@app.get("/sync/whoop")
async def sync_whoop():
    data = await sync_whoop_today()
    if not data:
        return JSONResponse(status_code=401, content={"error": "No valid Whoop token"})
    return {"status": "synced", "data": data}


@app.post("/webhook/sms")
async def webhook_sms(request: Request, background_tasks: BackgroundTasks):
    twiml_empty = Response(content='<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>', media_type="application/xml")
    try:
        form = await request.form()
        incoming_message = form.get("Body", "").strip()
        from_number = form.get("From", "")
        num_media = int(form.get("NumMedia", "0"))
        media_content_type = form.get("MediaContentType0", "") if num_media > 0 else ""
        media_url = form.get("MediaUrl0", "") if num_media > 0 else ""

        logger.info(f"SMS from {from_number}: text='{incoming_message}' media={num_media} type={media_content_type}")
        background_tasks.add_task(
            process_sms_webhook, incoming_message, from_number,
            num_media, media_content_type, media_url,
        )
    except Exception as e:
        logger.error(f"Webhook parse error: {e}", exc_info=True)

    return twiml_empty


@app.post("/webhook/whoop")
async def webhook_whoop(request: Request, background_tasks: BackgroundTasks):
    body = await request.body()
    signature = request.headers.get("X-WHOOP-Signature", "")
    timestamp = request.headers.get("X-WHOOP-Signature-Timestamp", "")

    if not verify_whoop_signature(body, timestamp, signature):
        logger.warning("WHOOP webhook signature verification failed")
        return JSONResponse(status_code=401, content={"error": "Invalid signature"})

    try:
        payload = json.loads(body)
        logger.info(f"WHOOP webhook: {payload.get('type')} trace={payload.get('trace_id')}")
        background_tasks.add_task(process_whoop_webhook, payload)
    except Exception as e:
        logger.error(f"WHOOP webhook parse error: {e}")

    return {"status": "received"}


@app.post("/checkin/{period}")
async def checkin(period: str, background_tasks: BackgroundTasks):
    if period == "morning":
        background_tasks.add_task(handle_morning_planning, 0, {})
        return {"status": "initiated", "flow": "morning_planning"}
    elif period == "midday":
        background_tasks.add_task(handle_midday_checkin)
        return {"status": "initiated", "flow": "midday_checkin"}
    elif period == "evening":
        background_tasks.add_task(handle_evening_checkin)
        return {"status": "initiated", "flow": "evening_checkin"}
    elif period == "night":
        background_tasks.add_task(handle_night_summary)
        return {"status": "initiated", "flow": "night_summary"}
    else:
        return JSONResponse(status_code=400, content={"error": f"Unknown period: {period}"})


@app.get("/debug/webhook")
async def debug_webhook():
    steps = {}
    steps["env_check"] = {
        "OPENAI_API_KEY": f"{'set (' + OPENAI_API_KEY[:8] + '...)' if OPENAI_API_KEY else 'NOT SET'}",
        "ANTHROPIC_API_KEY": f"{'set' if ANTHROPIC_API_KEY else 'NOT SET'}",
        "SUPABASE_DB_HOST": f"{'set' if SUPABASE_DB_HOST else 'NOT SET'}",
        "SUPABASE_KEY": f"{'set' if SUPABASE_KEY else 'NOT SET'}",
        "WHOOP_CLIENT_SECRET": f"{'set' if WHOOP_CLIENT_SECRET else 'NOT SET'}",
    }
    try:
        settings = get_settings()
        steps["settings"] = f"OK — {len(settings)} keys"
    except Exception as e:
        steps["settings"] = f"FAIL: {e}"
        return {"steps": steps}
    try:
        food_rows, food_totals = get_today_food_log()
        steps["food_log"] = f"OK — {len(food_rows)} rows"
    except Exception as e:
        steps["food_log"] = f"FAIL: {e}"
        return {"steps": steps}
    try:
        whoop_data = get_today_whoop_cache()
        steps["whoop_cache"] = f"OK — {'found' if whoop_data else 'empty'}"
    except Exception as e:
        steps["whoop_cache"] = f"FAIL: {e}"
        return {"steps": steps}
    try:
        memory = get_mem0()
        steps["mem0_init"] = "OK"
    except Exception as e:
        steps["mem0_init"] = f"FAIL: {e}"
        return {"steps": steps}
    try:
        memories_result = memory.search(query="test", user_id=USER_ID)
        steps["mem0_search"] = f"OK — {len(memories_result) if isinstance(memories_result, list) else 'non-list'} results"
    except Exception as e:
        steps["mem0_search"] = f"FAIL: {e}"
        return {"steps": steps}
    try:
        state = get_conversation_state()
        steps["conversation_state"] = f"OK — flow={state.get('flow')}, step={state.get('step')}"
    except Exception as e:
        steps["conversation_state"] = f"FAIL: {e}"
    steps["all_passed"] = True
    return {"steps": steps}


@app.get("/debug/voice")
async def debug_voice():
    steps = {}
    try:
        import imageio_ffmpeg
        ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
        steps["ffmpeg"] = f"OK — {ffmpeg_path}"
    except Exception as e:
        steps["ffmpeg"] = f"FAIL: {e}"
        return {"steps": steps}

    try:
        result = subprocess.run(
            [ffmpeg_path, "-version"],
            capture_output=True, timeout=5,
        )
        version_line = result.stdout.decode().split("\n")[0] if result.returncode == 0 else result.stderr.decode()[:200]
        steps["ffmpeg_version"] = f"OK — {version_line}"
    except Exception as e:
        steps["ffmpeg_version"] = f"FAIL: {e}"

    try:
        openai_client = openai.OpenAI(api_key=OPENAI_API_KEY)
        steps["openai_client"] = "OK"
    except Exception as e:
        steps["openai_client"] = f"FAIL: {e}"

    steps["twilio_sid"] = f"{'set' if TWILIO_ACCOUNT_SID else 'NOT SET'}"
    steps["twilio_token"] = f"{'set' if TWILIO_AUTH_TOKEN else 'NOT SET'}"
    steps["openai_key"] = f"{'set' if OPENAI_API_KEY else 'NOT SET'}"

    return {"steps": steps}
