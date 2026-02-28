import os
import re
import json
import logging
import secrets
from datetime import datetime, timezone, date, time as dt_time
from urllib.parse import urlencode, urlparse

import httpx
import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Form, Response
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


ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER")
WHOOP_CLIENT_ID = os.getenv("WHOOP_CLIENT_ID")
WHOOP_CLIENT_SECRET = os.getenv("WHOOP_CLIENT_SECRET")
WHOOP_REDIRECT_URI = os.getenv("WHOOP_REDIRECT_URI")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY")
SUPABASE_DB_HOST = os.getenv("SUPABASE_DB_HOST")
SUPABASE_DB_PASSWORD = os.getenv("SUPABASE_DB_PASSWORD")
OWNER_PHONE_NUMBER = os.getenv("OWNER_PHONE_NUMBER")

WHOOP_BASE_URL = "https://api.prod.whoop.com/developer"
WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth"
WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
WHOOP_SCOPES = "read:recovery read:cycles read:workout read:sleep read:profile read:body_measurement"

_supabase: Client | None = None
_twilio_client: TwilioClient | None = None
_claude_client: anthropic.Anthropic | None = None


def get_supabase() -> Client:
    global _supabase
    if _supabase is None:
        _supabase = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
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


def get_mem0() -> Memory:
    parsed = urlparse(SUPABASE_DB_HOST)
    db_host = parsed.hostname or SUPABASE_DB_HOST
    db_port = parsed.port or 5432
    db_user = parsed.username or "postgres"
    db_password = parsed.password or SUPABASE_DB_PASSWORD
    db_name = parsed.path.lstrip("/") or "postgres"

    config = {
        "vector_store": {
            "provider": "pgvector",
            "config": {
                "host": db_host,
                "port": db_port,
                "dbname": db_name,
                "user": db_user,
                "password": db_password,
            },
        },
    }
    return Memory.from_config(config)


def get_settings() -> dict:
    result = get_supabase().table("settings").select("*").execute()
    return {row["key"]: row["value"] for row in result.data}


def get_today_food_log() -> tuple[list[dict], dict]:
    today_str = date.today().isoformat()
    result = (
        get_supabase().table("food_log")
        .select("*")
        .eq("date", today_str)
        .execute()
    )
    rows = result.data or []
    totals = {
        "calories": sum(r.get("calories") or 0 for r in rows),
        "protein_g": sum(float(r.get("protein_g") or 0) for r in rows),
        "carbs_g": sum(float(r.get("carbs_g") or 0) for r in rows),
        "fat_g": sum(float(r.get("fat_g") or 0) for r in rows),
    }
    return rows, totals


def get_today_whoop_cache() -> dict | None:
    today_str = date.today().isoformat()
    result = (
        get_supabase().table("whoop_cache")
        .select("*")
        .eq("date", today_str)
        .execute()
    )
    if result.data:
        return result.data[0]
    return None


def build_food_log_summary(rows: list[dict]) -> str:
    if not rows:
        return "No food logged yet today."
    lines = []
    for r in rows:
        lines.append(
            f"- {r.get('time', '??:??')} {r.get('description', 'unknown')}: "
            f"{r.get('calories', 0)} kcal, {r.get('protein_g', 0)}g P, "
            f"{r.get('carbs_g', 0)}g C, {r.get('fat_g', 0)}g F"
        )
    return "\n".join(lines)


def determine_calorie_target(strain_score: float | None, settings: dict) -> int:
    low_thresh = float(settings.get("low_strain_threshold", "7"))
    high_thresh = float(settings.get("high_strain_threshold", "13"))
    goal_low = int(settings.get("calorie_goal_low_day", "2000"))
    goal_normal = int(settings.get("calorie_goal_normal_day", "2450"))
    goal_high = int(settings.get("calorie_goal_high_day", "2900"))

    if strain_score is None:
        return goal_normal
    if strain_score <= low_thresh:
        return goal_low
    if strain_score >= high_thresh:
        return goal_high
    return goal_normal


def build_system_prompt(
    settings: dict,
    whoop_data: dict | None,
    food_rows: list[dict],
    food_totals: dict,
    memories: list,
) -> str:
    strain = whoop_data.get("strain_score") if whoop_data else None
    calorie_target = determine_calorie_target(strain, settings)
    remaining = calorie_target - food_totals["calories"]

    cal_low = settings.get("calorie_goal_low_day", "2000")
    cal_normal = settings.get("calorie_goal_normal_day", "2450")
    cal_high = settings.get("calorie_goal_high_day", "2900")

    whoop_strain = strain if strain is not None else "N/A"
    whoop_burned = whoop_data.get("calories_burned_kcal", "N/A") if whoop_data else "N/A"
    whoop_recovery = whoop_data.get("recovery_score", "N/A") if whoop_data else "N/A"
    whoop_hrv = whoop_data.get("hrv_rmssd", "N/A") if whoop_data else "N/A"
    whoop_rhr = whoop_data.get("resting_heart_rate", "N/A") if whoop_data else "N/A"
    whoop_sleep = whoop_data.get("sleep_performance_pct", "N/A") if whoop_data else "N/A"

    food_summary = build_food_log_summary(food_rows)
    mem_text = "\n".join(m.get("memory", str(m)) for m in memories) if memories else "No memories yet."

    return f"""You are Kyle's personal nutrition coach. You communicate via SMS — keep responses under 300 characters. Be direct and specific, never generic.

KYLE'S BASELINE PROFILE:
BMR: 1,700 kcal/day
90-day average burn: 2,375 kcal/day
Goal mode: maintenance
Dietary preferences: none
Health priorities: testosterone and hematocrit support — under-fueling is a bigger risk than over-fueling

STRAIN-BASED DAILY TARGETS:
Low strain day (Strain ≤7): burn ~2,000 kcal → target {cal_low} kcal intake
Normal day (Strain 8–12): burn ~2,450 kcal → target {cal_normal} kcal intake
High strain day (Strain ≥13): burn ~2,900 kcal → target {cal_high} kcal intake
Monster day (Strain 17+): target ~3,100 kcal, slightly elevated next 2 days
If goal_mode is recomposition, reduce all targets by 175 kcal

TODAY'S WHOOP DATA:
Strain: {whoop_strain} → Today's calorie target: {calorie_target} kcal
Calories burned so far: {whoop_burned} kcal
Recovery: {whoop_recovery}%
HRV: {whoop_hrv}ms | RHR: {whoop_rhr}bpm
Sleep performance: {whoop_sleep}%

TODAY'S FOOD LOG:
{food_summary}
Eaten so far: {food_totals['calories']} kcal | Protein: {food_totals['protein_g']}g | Carbs: {food_totals['carbs_g']}g | Fat: {food_totals['fat_g']}g
Remaining: {remaining} kcal toward today's {calorie_target} kcal target

MEMORIES ABOUT KYLE:
{mem_text}

INSTRUCTIONS:
When Kyle describes food: estimate calories and macros, confirm back with remaining calories. Always include remaining kcal in your response.
When Kyle asks questions: give direct, specific advice based on his actual data.
Adjust for recovery: if recovery <50%, suggest anti-inflammatory foods. If recovery >80%, support performance.
Always prioritize protein at 1.6–2.0g/kg. Never let fat drop too low.
After every response that includes food, append structured data in this exact format on a new line:
<meal>{{"calories": 450, "protein_g": 35, "carbs_g": 40, "fat_g": 12, "description": "two eggs and toast"}}</meal>"""


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


def log_food(meal_data: dict):
    now = datetime.now(timezone.utc)
    get_supabase().table("food_log").insert({
        "date": date.today().isoformat(),
        "time": now.strftime("%H:%M:%S"),
        "description": meal_data.get("description", ""),
        "calories": meal_data.get("calories", 0),
        "protein_g": meal_data.get("protein_g", 0),
        "carbs_g": meal_data.get("carbs_g", 0),
        "fat_g": meal_data.get("fat_g", 0),
        "source": "sms",
    }).execute()


def log_conversation(direction: str, message: str):
    get_supabase().table("conversation_log").insert({
        "direction": direction,
        "message": message,
    }).execute()


def send_sms(to: str, body: str):
    get_twilio().messages.create(
        body=body,
        from_=TWILIO_PHONE_NUMBER,
        to=to,
    )


async def get_whoop_token() -> str | None:
    result = get_supabase().table("whoop_tokens").select("*").eq("id", 1).execute()
    if not result.data:
        logger.error("No Whoop tokens found in database")
        return None

    token_row = result.data[0]
    expires_at_str = token_row.get("expires_at")
    if expires_at_str:
        expires_at = datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        if (expires_at - now).total_seconds() < 300:
            logger.info("Whoop token expiring soon, refreshing...")
            return await refresh_whoop_token(token_row["refresh_token"])

    return token_row["access_token"]


async def refresh_whoop_token(refresh_token: str) -> str | None:
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

        new_expires = datetime.now(timezone.utc).timestamp() + data["expires_in"]
        expires_at = datetime.fromtimestamp(new_expires, tz=timezone.utc).isoformat()

        get_supabase().table("whoop_tokens").upsert({
            "id": 1,
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token", refresh_token),
            "expires_at": expires_at,
        }).execute()

        logger.info("Whoop token refreshed successfully")
        return data["access_token"]
    except Exception as e:
        logger.error(f"Failed to refresh Whoop token: {e}")
        return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
async def root():
    return RedirectResponse(url="/auth/whoop")


@app.get("/health")
async def health():
    return {"status": "ok"}


_oauth_states: set[str] = set()


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
        return JSONResponse(
            status_code=400,
            content={"error": error, "description": error_description},
        )
    if not code:
        return JSONResponse(
            status_code=400,
            content={"error": "No authorization code received from WHOOP"},
        )
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
                return JSONResponse(
                    status_code=502,
                    content={
                        "error": "Token exchange failed",
                        "whoop_status": resp.status_code,
                        "whoop_response": resp.text,
                    },
                )
            data = resp.json()
    except Exception as e:
        logger.error(f"WHOOP token exchange request failed: {e}")
        return JSONResponse(
            status_code=502,
            content={"error": f"Token exchange request failed: {str(e)}"},
        )

    try:
        logger.info(f"WHOOP token response keys: {list(data.keys())}")
        expires_in = data.get("expires_in", 3600)
        new_expires = datetime.now(timezone.utc).timestamp() + expires_in
        expires_at = datetime.fromtimestamp(new_expires, tz=timezone.utc).isoformat()

        token_row = {
            "id": 1,
            "access_token": data["access_token"],
            "expires_at": expires_at,
        }
        if data.get("refresh_token"):
            token_row["refresh_token"] = data["refresh_token"]

        get_supabase().table("whoop_tokens").upsert(token_row).execute()
    except Exception as e:
        logger.error(f"Failed to store WHOOP tokens in Supabase: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": f"Failed to store tokens: {str(e)}"},
        )

    return {"status": "connected", "message": "Whoop OAuth2 tokens stored successfully"}


@app.get("/sync/whoop")
async def sync_whoop():
    token = await get_whoop_token()
    if not token:
        return JSONResponse(status_code=401, content={"error": "No valid Whoop token"})

    now = datetime.now(timezone.utc)
    today_midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start = today_midnight.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    end = now.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    headers = {"Authorization": f"Bearer {token}"}

    whoop_data = {
        "strain_score": None,
        "calories_burned_kcal": None,
        "recovery_score": None,
        "hrv_rmssd": None,
        "resting_heart_rate": None,
        "sleep_performance_pct": None,
        "sleep_hours": None,
    }

    async with httpx.AsyncClient() as client:
        # Cycles
        try:
            resp = await client.get(
                f"{WHOOP_BASE_URL}/v2/cycle",
                params={"start": start, "end": end, "limit": 1},
                headers=headers,
            )
            resp.raise_for_status()
            records = resp.json().get("records", [])
            for rec in records:
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
            records = resp.json().get("records", [])
            for rec in records:
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
            records = resp.json().get("records", [])
            for rec in records:
                if rec.get("score_state") == "SCORED" and rec.get("score"):
                    whoop_data["sleep_performance_pct"] = rec["score"].get("sleep_performance_percentage")
                    sleep_start = rec.get("start")
                    sleep_end = rec.get("end")
                    if sleep_start and sleep_end:
                        s = datetime.fromisoformat(sleep_start.replace("Z", "+00:00"))
                        e = datetime.fromisoformat(sleep_end.replace("Z", "+00:00"))
                        whoop_data["sleep_hours"] = round((e - s).total_seconds() / 3600, 2)
                    break
        except Exception as e:
            logger.error(f"Error fetching Whoop sleep: {e}")

        # Workouts
        try:
            resp = await client.get(
                f"{WHOOP_BASE_URL}/v2/activity/workout",
                params={"start": start, "end": end, "limit": 5},
                headers=headers,
            )
            resp.raise_for_status()
            records = resp.json().get("records", [])
            workout_kj = 0
            workout_names = []
            for rec in records:
                if rec.get("score_state") == "SCORED" and rec.get("score"):
                    workout_kj += rec["score"].get("kilojoule", 0)
                    if rec.get("sport_name"):
                        workout_names.append(rec["sport_name"])
            if workout_kj > 0:
                logger.info(f"Workouts today: {', '.join(workout_names)}, total {round(workout_kj / 4.184, 1)} kcal")
        except Exception as e:
            logger.error(f"Error fetching Whoop workouts: {e}")

    today_str = date.today().isoformat()
    upsert_payload = {
        "date": today_str,
        "last_updated": now.isoformat(),
    }
    for k, v in whoop_data.items():
        if v is not None:
            upsert_payload[k] = v

    get_supabase().table("whoop_cache").upsert(upsert_payload, on_conflict="date").execute()

    return {"status": "synced", "data": whoop_data}


@app.post("/webhook/sms")
async def webhook_sms(request: Request):
    try:
        form = await request.form()
        incoming_message = form.get("Body", "")
        from_number = form.get("From", "")

        logger.info(f"SMS from {from_number}: {incoming_message}")

        settings = get_settings()
        food_rows, food_totals = get_today_food_log()
        whoop_data = get_today_whoop_cache()

        try:
            memory = get_mem0()
            memories_result = memory.search(query=incoming_message, user_id="kyle")
            memories = memories_result if isinstance(memories_result, list) else []
        except Exception as e:
            logger.error(f"Mem0 search failed: {e}")
            memories = []

        system_prompt = build_system_prompt(settings, whoop_data, food_rows, food_totals, memories)

        response = get_claude().messages.create(
            model="claude-opus-4-6",
            max_tokens=512,
            system=system_prompt,
            messages=[{"role": "user", "content": incoming_message}],
        )
        claude_response = response.content[0].text

        clean_message, meal_data = parse_meal_data(claude_response)

        if meal_data:
            log_food(meal_data)

        send_sms(to=from_number, body=clean_message)

        log_conversation("inbound", incoming_message)
        log_conversation("outbound", claude_response)

        try:
            memory = get_mem0()
            memory.add(
                messages=[
                    {"role": "user", "content": incoming_message},
                    {"role": "assistant", "content": claude_response},
                ],
                user_id="kyle",
            )
        except Exception as e:
            logger.error(f"Mem0 add failed: {e}")

        twiml = """<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>"""
        return Response(content=twiml, media_type="application/xml")

    except Exception as e:
        logger.error(f"Webhook error: {e}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "type": type(e).__name__},
        )


@app.post("/checkin")
async def checkin():
    settings = get_settings()
    food_rows, food_totals = get_today_food_log()
    whoop_data = get_today_whoop_cache()

    try:
        memory = get_mem0()
        memories_result = memory.search(query="meal check-in", user_id="kyle")
        memories = memories_result if isinstance(memories_result, list) else []
    except Exception as e:
        logger.error(f"Mem0 search failed: {e}")
        memories = []

    system_prompt = build_system_prompt(settings, whoop_data, food_rows, food_totals, memories)

    user_message = (
        "Generate a meal check-in message for Kyle based on his current data. "
        "Be specific about what he should eat at his next meal given his strain "
        "and remaining calories. Keep it under 300 characters."
    )

    response = get_claude().messages.create(
        model="claude-opus-4-6",
        max_tokens=512,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )
    claude_response = response.content[0].text

    clean_message, meal_data = parse_meal_data(claude_response)
    if meal_data:
        log_food(meal_data)

    send_sms(to=OWNER_PHONE_NUMBER, body=clean_message)

    log_conversation("outbound", claude_response)

    return {"status": "sent", "message": clean_message}


@app.post("/summary")
async def summary():
    settings = get_settings()
    food_rows, food_totals = get_today_food_log()
    whoop_data = get_today_whoop_cache()

    try:
        memory = get_mem0()
        memories_result = memory.search(query="daily nutrition summary", user_id="kyle")
        memories = memories_result if isinstance(memories_result, list) else []
    except Exception as e:
        logger.error(f"Mem0 search failed: {e}")
        memories = []

    system_prompt = build_system_prompt(settings, whoop_data, food_rows, food_totals, memories)

    user_message = (
        "Generate Kyle's end of day nutrition summary. Include: total calories "
        "eaten vs target, protein vs goal, biggest gap or win today, and one "
        "specific recommendation for tomorrow based on his Whoop data. "
        "Keep it under 320 characters."
    )

    response = get_claude().messages.create(
        model="claude-opus-4-6",
        max_tokens=512,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )
    claude_response = response.content[0].text

    clean_message, meal_data = parse_meal_data(claude_response)
    if meal_data:
        log_food(meal_data)

    send_sms(to=OWNER_PHONE_NUMBER, body=clean_message)

    log_conversation("outbound", claude_response)

    return {"status": "sent", "message": clean_message}
