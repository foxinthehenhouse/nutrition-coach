import os
import re
import json
import base64
import hmac
import hashlib
import logging
import secrets
import asyncio
import subprocess
import tempfile
from datetime import datetime, timezone, date, time as dt_time, timedelta
from urllib.parse import urlencode
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
import openai
import anthropic
import certifi
import imageio_ffmpeg
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response, BackgroundTasks
from fastapi import File, UploadFile, Form
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
SYNC_ADMIN_TOKEN = os.getenv("SYNC_ADMIN_TOKEN")
DISABLE_PROACTIVE_SMS = os.getenv("DISABLE_PROACTIVE_SMS", "").strip().lower() in ("1", "true", "yes")

WHOOP_BASE_URL = "https://api.prod.whoop.com/developer"
WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth"
WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
WHOOP_SCOPES = "offline read:recovery read:cycles read:workout read:sleep read:profile read:body_measurement"

USER_ID = "kyle"
DEFAULT_TIMEZONE = "Australia/Sydney"

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
    url = (url or "").strip()
    if not url:
        return {}
    prefix = "postgresql://" if url.startswith("postgresql://") else "postgres://" if url.startswith("postgres://") else None
    if not prefix:
        return {}
    stripped = url[len(prefix):]
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

USER_ID = "kyle"


def get_mem0() -> Memory:
    parsed = _parse_db_url(SUPABASE_DB_HOST)
    host = parsed.get("host", "localhost")
    raw = (SUPABASE_DB_HOST or "").strip()
    if host == "localhost" and raw and not (raw.startswith("postgresql://") or raw.startswith("postgres://")):
        logger.warning(
            "SUPABASE_DB_HOST should be a full postgresql:// URL. Got host=localhost; mem0 may fail. "
            "Example: postgresql://user:pass@host:5432/postgres"
        )
    vector_config = {
        "host": host,
        "port": parsed.get("port", 5432),
        "dbname": parsed.get("dbname", "postgres"),
        "user": parsed.get("user", "postgres"),
        "password": parsed.get("password") or SUPABASE_DB_PASSWORD,
    }
    config = {
        "vector_store": {
            "provider": "pgvector",
            "config": vector_config,
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


def get_user_timezone(settings: dict | None = None) -> ZoneInfo:
    cfg = settings or get_settings()
    tz_name = cfg.get("timezone") or cfg.get("tz") or DEFAULT_TIMEZONE
    try:
        return ZoneInfo(str(tz_name))
    except ZoneInfoNotFoundError:
        logger.warning(f"Invalid timezone '{tz_name}', defaulting to {DEFAULT_TIMEZONE}")
        return ZoneInfo(DEFAULT_TIMEZONE)


def get_local_now(settings: dict | None = None) -> datetime:
    return datetime.now(timezone.utc).astimezone(get_user_timezone(settings))


def get_local_today(settings: dict | None = None) -> date:
    return get_local_now(settings).date()


def _as_local_date_from_iso(ts: str, settings: dict | None = None) -> date | None:
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(get_user_timezone(settings)).date()
    except (ValueError, TypeError):
        return None


def _parse_hms(value: str | None) -> dt_time | None:
    if not value:
        return None
    raw = str(value).strip()
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(raw, fmt).time()
        except ValueError:
            continue
    return None


def get_today_food_log() -> tuple[list[dict], dict]:
    today_str = get_local_today().isoformat()
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
    return get_whoop_cache(get_local_today())


def get_whoop_cache(target_date: date) -> dict | None:
    today_str = target_date.isoformat()
    result = get_supabase().table("whoop_cache").select("*").eq("date", today_str).execute()
    return result.data[0] if result.data else None


def get_today_daily_plan() -> dict | None:
    today_str = get_local_today().isoformat()
    result = get_supabase().table("daily_plans").select("*").eq("date", today_str).execute()
    return result.data[0] if result.data else None


def upsert_daily_plan(data: dict):
    data["date"] = get_local_today().isoformat()
    get_supabase().table("daily_plans").upsert(data, on_conflict="date").execute()


def get_conversation_state() -> dict:
    result = get_supabase().table("conversation_state").select("*").eq("id", 1).execute()
    if result.data:
        return result.data[0]
    default = {"id": 1, "flow": "free_chat", "step": 0, "context": {}}
    get_supabase().table("conversation_state").upsert(default).execute()
    return default


async def get_conversation_state_by_phone(from_number: str) -> dict:
    """Get image confirmation state for a phone number. Uses image_confirmation_state table."""
    try:
        result = get_supabase().table("image_confirmation_state").select("*").eq("phone", from_number).execute()
        if result.data:
            row = result.data[0]
            return {"flow": row.get("flow", "free_chat"), "step": row.get("step", 0), "context": row.get("context") or {}}
    except Exception as e:
        logger.warning(f"get_conversation_state_by_phone failed: {e}")
    return {"flow": "free_chat", "step": 0, "context": {}}


async def update_conversation_state_by_phone(from_number: str, flow: str, step: int, context: dict):
    try:
        get_supabase().table("image_confirmation_state").upsert({
            "phone": from_number, "flow": flow, "step": step, "context": context,
            "updated_at": datetime.utcnow().isoformat(),
        }, on_conflict="phone").execute()
    except Exception as e:
        logger.warning(f"update_conversation_state_by_phone failed: {e}")


async def get_food_log_totals(target_date: date) -> dict:
    """Get calorie and macro totals for a given date."""
    today_str = target_date.isoformat()
    result = get_supabase().table("food_log").select("calories, protein_g, carbs_g, fat_g").eq("date", today_str).execute()
    rows = result.data or []
    return {
        "calories": sum(r.get("calories") or 0 for r in rows),
        "protein_g": sum(float(r.get("protein_g") or 0) for r in rows),
        "carbs_g": sum(float(r.get("carbs_g") or 0) for r in rows),
        "fat_g": sum(float(r.get("fat_g") or 0) for r in rows),
    }


async def get_recent_food_log_descriptions(target_date: date, limit: int = 3) -> list[str]:
    """Get recent meal descriptions for context."""
    today_str = target_date.isoformat()
    result = get_supabase().table("food_log").select("description").eq("date", today_str).order("time", desc=True).limit(limit).execute()
    return [r.get("description", "") for r in (result.data or []) if r.get("description")]


def get_calorie_target(strain_score: float | None, settings: dict) -> int:
    return get_targets(strain_score, settings)["calories"]


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
    now = get_local_now()
    row = {
        "date": now.date().isoformat(),
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
    }
    if meal_data.get("components"):
        row["components"] = json.dumps(meal_data["components"]) if not isinstance(meal_data["components"], str) else meal_data["components"]
    for micro in ("iron_mg", "calcium_mg", "potassium_mg", "vitamin_d_mcg", "magnesium_mg", "zinc_mg", "b12_mcg"):
        if meal_data.get(micro) is not None:
            row[micro] = meal_data[micro]
    get_supabase().table("food_log").insert(row).execute()


def log_conversation(direction: str, message: str, flow: str | None = None, source: str | None = None):
    row = {"direction": direction, "message": message, "flow": flow}
    if source:
        row["source"] = source
    get_supabase().table("conversation_log").insert(row).execute()


def get_recent_conversation(limit: int = 24, exclude_last_inbound: bool = False) -> list[dict]:
    """Fetch recent user/assistant turns for multi-turn context. Returns list of {role, content}."""
    try:
        result = (
            get_supabase().table("conversation_log")
            .select("direction, message")
            .in_("direction", ["inbound", "outbound"])
            .neq("message", "")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        rows = result.data or []
        if exclude_last_inbound and rows and rows[0].get("direction") == "inbound":
            rows = rows[1:]
        rows = [r for r in reversed(rows) if not (r.get("message") or "").startswith("whoop_trace:")]
        messages = []
        prev_role, prev_content = None, None
        for r in rows:
            role = "user" if r.get("direction") == "inbound" else "assistant"
            content = (r.get("message") or "").strip()
            if not content:
                continue
            if role == prev_role and content == prev_content:
                continue
            prev_role, prev_content = role, content
            messages.append({"role": role, "content": content})
        return messages
    except Exception as e:
        logger.warning(f"get_recent_conversation failed: {e}")
        return []


def log_to_conversation(inbound: str, outbound: str, source: str = "text", flow: str = "free_chat"):
    log_conversation("inbound", inbound, flow=flow, source=source)
    log_conversation("outbound", outbound, flow=flow, source="system")


def send_sms(to: str, body: str, proactive: bool = False):
    if proactive and DISABLE_PROACTIVE_SMS:
        logger.info("Proactive SMS disabled (DISABLE_PROACTIVE_SMS); would have sent to %s: %s", to, body[:80])
        return
    body = strip_sms_markdown(body) if body else body
    get_twilio().messages.create(body=body, from_=TWILIO_PHONE_NUMBER, to=to)


# ---------------------------------------------------------------------------
# SMS-friendly text (strip markdown — SMS doesn't support bold/formatting)
# ---------------------------------------------------------------------------

def strip_sms_markdown(text: str) -> str:
    """Remove markdown so SMS displays plain text. Asterisks etc show literally otherwise."""
    if not text:
        return text
    s = text
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    s = re.sub(r"__(.+?)__", r"\1", s)
    s = re.sub(r"\*(.+?)\*", r"\1", s)
    s = re.sub(r"_(.+?)_", r"\1", s)
    s = re.sub(r"`(.+?)`", r"\1", s)
    s = re.sub(r"^#+\s*", "", s, flags=re.MULTILINE)
    return s.strip()


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
    ssl_context = certifi.where()
    async with httpx.AsyncClient(follow_redirects=True, verify=ssl_context) as client:
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
# Food photo analysis
# ---------------------------------------------------------------------------

def _safe_json(obj) -> str:
    """JSON serialize with fallback for non-serializable types."""
    try:
        return json.dumps(obj, default=str)
    except Exception:
        return str(obj) if obj else "none"


def _extract_json_from_response(raw: str) -> str:
    """Extract JSON object from Claude response (markdown, wrappers, etc)."""
    if not raw:
        return raw
    if "```" in raw:
        for part in raw.split("```")[1:]:
            part = part.strip()
            if part.lower().startswith("json"):
                part = part[4:].lstrip()
            if part.startswith("{"):
                return part.strip()
    if "{" in raw and "}" in raw:
        start = raw.index("{")
        depth = 0
        in_str = None
        escape = False
        for i, c in enumerate(raw[start:], start):
            if escape:
                escape = False
                continue
            if c == "\\" and in_str:
                escape = True
                continue
            if in_str:
                if c == in_str:
                    in_str = None
                continue
            if c in '"\'':
                in_str = c
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return raw[start : i + 1]
    return raw.strip()


async def analyze_meal_image(
    image_base64: str, content_type: str, context: dict
) -> dict:
    """Core Claude vision function for food detection and nutrition estimation."""
    daily_plan_str = _safe_json(context.get("daily_plan")) if context.get("daily_plan") else "none"
    context_str = f"""
KYLE'S CONTEXT:
- Calorie target today: {context.get('calorie_target')} kcal
- Eaten so far: {context.get('eaten_calories')} kcal | Protein: {context.get('eaten_protein')}g
- Remaining: {context.get('remaining_calories')} kcal
- Protein target: {context.get('protein_target')}g
- Carb target: {context.get('carb_target')}g
- Fat target: {context.get('fat_target')}g
- Recovery score: {context.get('recovery_score', 'unknown')}%
- Known food preferences: {context.get('food_memories', 'none yet')}
- Recent meals today: {context.get('recent_meals', 'none logged yet')}
- Daily plan: {daily_plan_str}
"""

    system_prompt = """You are a precision nutrition analysis system with the expertise of a
PhD sports dietitian combined with a computer vision specialist trained on food detection datasets
(Food-101, USDA food image libraries, MyFitnessPal meal database). Your single job is to extract
maximally accurate nutrition data from food images.

CORE PRINCIPLES:
- Never guess blindly. If you cannot identify something with reasonable confidence, say so.
- Portion size estimation is the highest source of error in food image analysis. Treat it
  with the most scrutiny.
- Account for hidden calories: cooking oils, sauces, dressings, butter, marinades. These are
  systematically underestimated and are often the largest source of inaccuracy.
- Distinguish between raw and cooked weights. Cooked chicken breast weighs ~25% less than raw.
- Restaurant portions are typically 1.5–2x larger than home portions for the same dish.
  If plating looks like a restaurant, adjust upward accordingly.

VISUAL ANALYSIS PROTOCOL — execute in sequence:

STEP 1 — SCENE CLASSIFICATION
- Context: home cooked / restaurant / fast food / packaged
- Plate or bowl size (standard dinner plate = 10-11 inches, side plate = 7-8 inches,
  bowl = 12-16 oz capacity)
- Meal completeness: is this the full meal or partial?

STEP 2 — FOOD ITEM DETECTION
Systematically scan the entire image:
- Identify every distinct food item including garnishes, condiments, sides, beverages
- Do not overlook: sauces pooled at bottom, oils glistening on surface, melted cheese,
  croutons, toppings, drinks visible in frame
- For mixed dishes (stir fries, salads, grain bowls, pasta, stews): decompose into
  individual components, estimate each separately
- Classify each item: protein / complex carb / simple carb / vegetable / fat source /
  condiment / beverage

STEP 3 — PORTION SIZE ESTIMATION
For each item, use this hierarchy of visual anchors (most to least reliable):
1. Known reference objects in frame: utensils (fork ~7 inches), hands, glasses,
   condiment packets, recognizable packaging
2. Plate or bowl dimension calibration from Step 1
3. Food density and pile height estimation
4. Standard serving size as prior — then adjust up or down based on visual evidence

State your reasoning for any item where portion size is uncertain.

Common portion benchmarks:
- Chicken breast (cooked): palm-sized = ~120-140g = ~160-185 kcal
- Salmon fillet: deck-of-cards size = ~150g = ~280 kcal
- Cooked rice (in bowl): tennis ball volume = ~150g = ~195 kcal
- Pasta (restaurant plated): typically 200-300g cooked = 280-420 kcal
- Salad greens (full bowl): ~60-100g = negligible kcal
- Olive oil (visible sheen on food): estimate 1-2 tbsp used in cooking
- Avocado half: ~75g = ~120 kcal
- Avocado quarter: ~37g = ~60 kcal

STEP 4 — HIDDEN CALORIE AUDIT
Actively identify and estimate:
- Cooking fat: oil sheen visible? Butter? Estimate tbsp.
- Sauces and dressings: pooled, drizzled, or absorbed? Estimate volume.
- Cheese: coverage area (~30g per quarter-plate coverage)
- Breading or batter on proteins: adds ~50-100 kcal per piece
- Sugary glazes (teriyaki, BBQ, honey): add ~40-80 kcal per serving
- Nuts or seeds as toppings: small handful (~20g) = ~120 kcal

STEP 5 — MACRO AND MICRONUTRIENT CALCULATION
- Use USDA FoodData Central as primary reference
- For recognizable restaurant or branded items, use known chain nutritional data
- Calculate per component: calories, protein (g), carbs (g), fiber (g), total fat (g),
  saturated fat (g), sodium (mg), sugar (g)
- Sum all components for meal totals
- Apply confidence buffer: medium confidence = add 10% to calorie total;
  low confidence = add 15% to calorie total

STEP 6 — SPORTS NUTRITION ASSESSMENT
- Protein quality: is this a complete protein source?
- Post-workout suitability: if this looks like a post-workout meal, flag if protein
  is under 40g or fast carbs are absent
- Micronutrient alerts: flag if sodium >800mg, fiber <3g, or saturated fat >10g
- Inflammatory risk: if recovery score is low (<50%), flag pro-inflammatory foods
  (refined carbs, fried foods, processed meats)

CONFIDENCE SCORING:
- HIGH: clear image, recognizable foods, visible portion anchors, single-layer plating
- MEDIUM: some items unclear, sauce quantities uncertain, mixed dish components estimated,
  partial plate view
- LOW: blurry image, heavily mixed dish with no anchors, unusual cuisine,
  partially eaten food making original portion unclear

OUTPUT FORMAT — You must respond with valid JSON only. No markdown, no code fences, no explanatory text before or after.

JSON RULES (critical for parsing):
- Use double quotes for all strings. No single quotes.
- No trailing commas (e.g. "calories": 650, } is invalid — remove the comma before })
- No comments. No // or /*
- Escape quotes inside strings: use \\" not "
- Keep string values simple; avoid line breaks or complex punctuation inside values

REQUIRED STRUCTURE — Return this exact shape. All fields required unless optional is noted:
{
  "components": [{"food": "item name", "portion_estimate": "140g", "calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0}],
  "totals": {"calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0, "fiber_g": 0, "sodium_mg": 0, "sugar_g": 0},
  "meal_type": "breakfast" or "lunch" or "dinner" or "snack",
  "overall_confidence": "high" or "medium" or "low",
  "sms_confirmation": "MUST include: (1) Each ingredient with approx portion, e.g. Grilled chicken 140g, rice 150g, roasted veg. (2) Totals line: X kcal | Xg P | Xg C | Xg F. (3) End with: Reply YES to log or correct me. Keep under 400 chars total."
}

SMS_CONFIRMATION FORMAT — Structure it as:
- Line 1: Ingredients list with portions (e.g. Chicken 140g, rice 150g, broccoli 80g)
- Line 2: Macros (e.g. 650 kcal | 45g P | 60g C | 18g F. Reply YES to log or correct me.)

Optional: add "scene", "hidden_calories", "confidence_notes", "sports_nutrition_flags" if useful.

If you cannot see food clearly or image is not a meal photo:
{"error": "cannot_analyze", "sms_confirmation": "I could not identify the meal. Try a clearer photo or describe it in text."}

Always respond with exactly one JSON object. Nothing else."""

    msg_content = [
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": content_type,
                "data": image_base64,
            },
        },
        {
            "type": "text",
            "text": f"{context_str}\n\nAnalyze this meal image following your protocol exactly. Return JSON only. No markdown, no code blocks, no other text — just the raw JSON object.",
        },
    ]
    try:
        response = get_claude().messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            system=system_prompt,
            messages=[{"role": "user", "content": msg_content}],
        )
    except Exception as e:
        logger.warning(f"Sonnet vision failed, trying Opus: {e}")
        try:
            response = get_claude().messages.create(
                model="claude-opus-4-6",
                max_tokens=2048,
                thinking={"type": "disabled"},
                system=system_prompt,
                messages=[{"role": "user", "content": msg_content}],
            )
        except Exception as e2:
            if "thinking" in str(e2).lower():
                response = get_claude().messages.create(
                    model="claude-opus-4-6",
                    max_tokens=2048,
                    system=system_prompt,
                    messages=[{"role": "user", "content": msg_content}],
                )
            else:
                raise

    if not response.content:
        raise ValueError("Claude returned empty response")

    raw = ""
    for block in response.content:
        block_type = block.get("type", "") if isinstance(block, dict) else getattr(block, "type", "")
        if block_type == "thinking":
            continue
        t = block.get("text") or block.get("thinking") if isinstance(block, dict) else (getattr(block, "text", None) or getattr(block, "thinking", None))
        if t:
            raw += t if isinstance(t, str) else str(t)
    if not raw.strip():
        types = [b.get("type", type(b).__name__) if isinstance(b, dict) else getattr(b, "type", type(b).__name__) for b in response.content]
        raise ValueError(f"Claude returned no text (block types: {types})")
    raw = raw.strip()

    if os.getenv("IMAGE_DEBUG"):
        logger.info(f"Image analysis raw response (first 1200 chars): {raw[:1200]}")

    raw = _extract_json_from_response(raw)

    result = None
    last_err = None
    for attempt in [raw, re.sub(r",\s*}", "}", raw), re.sub(r",\s*]", "]", raw)]:
        try:
            result = json.loads(attempt)
            break
        except json.JSONDecodeError as e:
            last_err = e
            continue
    if result is None:
        raw_clean = raw.replace("\n", " ")[:500]
        logger.warning(f"Claude JSON parse failed: {last_err}. Raw: {raw_clean}")
        raise ValueError("Could not parse the analysis. Try again or describe your meal in text.") from last_err

    if "error" in result:
        raise ValueError(result.get("sms_confirmation", "Could not analyze image."))

    totals = result.get("totals")
    if not totals or not isinstance(totals, dict):
        raise ValueError("Analysis incomplete. Try again or describe your meal in text.")

    if result.get("overall_confidence") == "medium":
        result["totals"]["calories"] = round((totals.get("calories") or 0) * 1.10)
    elif result.get("overall_confidence") == "low":
        result["totals"]["calories"] = round((totals.get("calories") or 0) * 1.15)

    return result


async def apply_meal_correction(correction: str, original_meal: dict) -> dict:
    """User corrected something about the meal estimate. Pass back to Claude to update."""
    response = get_claude().messages.create(
        model="claude-opus-4-6",
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": f"""You are a precision nutrition analyst.

Original meal analysis:
{json.dumps(original_meal, indent=2)}

User correction: "{correction}"

Update the meal analysis to reflect the correction.
Recalculate all affected component values and totals.
Update sms_confirmation to show the corrected values and ask for confirmation again.
Keep sms_confirmation under 300 characters.

Return the complete updated JSON in the exact same format as the original. JSON only, no other text.""",
            }
        ],
    )

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    return json.loads(raw.strip())


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


def _meal_signal_flags(food_rows: list[dict], now_local: datetime) -> dict:
    breakfast_logged = False
    lunch_logged = False
    last_meal_dt: datetime | None = None

    for row in food_rows:
        meal_type = str(row.get("meal_type") or "").strip().lower()
        t = _parse_hms(row.get("time"))
        if meal_type == "breakfast" or (t and t.hour < 11):
            breakfast_logged = True
        if meal_type == "lunch" or (t and 11 <= t.hour < 16):
            lunch_logged = True
        if t:
            meal_dt = datetime.combine(now_local.date(), t, tzinfo=now_local.tzinfo)
            if last_meal_dt is None or meal_dt > last_meal_dt:
                last_meal_dt = meal_dt

    hours_since_last_meal = None
    if last_meal_dt:
        hours_since_last_meal = round((now_local - last_meal_dt).total_seconds() / 3600, 1)

    missed_breakfast = now_local.hour >= 12 and not breakfast_logged
    missed_lunch = now_local.hour >= 17 and not lunch_logged
    long_gap = hours_since_last_meal is not None and hours_since_last_meal >= 5 and now_local.hour >= 11

    return {
        "breakfast_logged": breakfast_logged,
        "lunch_logged": lunch_logged,
        "missed_breakfast": missed_breakfast,
        "missed_lunch": missed_lunch,
        "long_gap_since_meal": long_gap,
        "hours_since_last_meal": hours_since_last_meal,
    }


def build_daily_metrics(
    settings: dict,
    food_rows: list[dict],
    food_totals: dict,
    whoop_data: dict | None,
    now_local: datetime | None = None,
) -> dict:
    now_local = now_local or get_local_now(settings)
    strain = whoop_data.get("strain_score") if whoop_data else None
    targets = get_targets(strain, settings)
    expected_by_now = int(round(targets["calories"] * max(0, now_local.hour - 7) / 13))
    eaten = int(food_totals.get("calories", 0) or 0)
    remaining = targets["calories"] - eaten
    pace_status = check_pace(targets["calories"], eaten, now_local.hour)
    meal_signals = _meal_signal_flags(food_rows, now_local)
    return {
        "local_date": now_local.date().isoformat(),
        "local_hour": now_local.hour,
        "targets": targets,
        "eaten": {
            "calories": eaten,
            "protein_g": float(food_totals.get("protein_g", 0) or 0),
            "carbs_g": float(food_totals.get("carbs_g", 0) or 0),
            "fat_g": float(food_totals.get("fat_g", 0) or 0),
            "fiber_g": float(food_totals.get("fiber_g", 0) or 0),
            "sodium_mg": float(food_totals.get("sodium_mg", 0) or 0),
            "sugar_g": float(food_totals.get("sugar_g", 0) or 0),
        },
        "expected_calories_by_now": expected_by_now,
        "delta_vs_pace": eaten - expected_by_now,
        "remaining_calories": remaining,
        "pace_status": pace_status,
        "meal_signals": meal_signals,
    }


# ---------------------------------------------------------------------------
# WHOOP token management
# ---------------------------------------------------------------------------

_last_whoop_token_alert_at: datetime | None = None
WHOOP_TOKEN_ALERT_COOLDOWN_HOURS = 24


async def get_whoop_token() -> str | None:
    global _last_whoop_token_alert_at
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
                now = datetime.now(timezone.utc)
                should_alert = (
                    _last_whoop_token_alert_at is None
                    or (now - _last_whoop_token_alert_at).total_seconds() > WHOOP_TOKEN_ALERT_COOLDOWN_HOURS * 3600
                )
                if should_alert:
                    try:
                        send_sms(OWNER_PHONE_NUMBER, "WHOOP token refresh failed. Re-auth at /auth/whoop", proactive=True)
                        _last_whoop_token_alert_at = now
                    except Exception:
                        pass
                return None
            return new_token
    return token_row["access_token"]


async def refresh_whoop_token(refresh_token: str, max_retries: int = 3) -> str | None:
    if not refresh_token:
        logger.error("No refresh token available")
        return None
    for attempt in range(1, max_retries + 1):
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
            logger.error(f"Whoop token refresh attempt {attempt}/{max_retries} failed: {e}")
            if attempt < max_retries:
                await asyncio.sleep(2 ** attempt)
    return None


# ---------------------------------------------------------------------------
# WHOOP sync
# ---------------------------------------------------------------------------

async def _sync_whoop_background():
    """Run WHOOP sync in background; don't block the response."""
    try:
        await sync_whoop_today()
    except Exception as e:
        logger.warning(f"Background Whoop sync failed: {e}")


def _whoop_record_date(rec: dict, settings: dict | None = None, use_end: bool = True) -> date | None:
    """Derive local calendar date from WHOOP record timestamps."""
    ts = rec.get("end") if use_end else rec.get("start")
    if not ts:
        ts = rec.get("created_at") or rec.get("updated_at")
    if not ts:
        return None
    return _as_local_date_from_iso(str(ts), settings)


async def _whoop_get_records_paginated(
    client: httpx.AsyncClient,
    endpoint: str,
    base_params: dict,
    headers: dict,
    max_pages: int = 30,
) -> list[dict]:
    records: list[dict] = []
    next_token = None
    pages = 0
    while pages < max_pages:
        params = base_params.copy()
        if next_token:
            params["nextToken"] = next_token
        resp = await client.get(f"{WHOOP_BASE_URL}{endpoint}", params=params, headers=headers)
        resp.raise_for_status()
        payload = resp.json()
        records.extend(payload.get("records", []))
        next_token = payload.get("next_token") or payload.get("nextToken")
        pages += 1
        if not next_token:
            break
    return records


def _merge_whoop_by_date(by_date: dict[str, dict], now: datetime | None = None):
    now = now or datetime.now(timezone.utc)
    for d_str, data in by_date.items():
        existing = get_whoop_cache(date.fromisoformat(d_str)) if d_str else None
        merged = {k: v for k, v in (existing or {}).items() if v is not None and k != "id"}
        merged["date"] = d_str
        merged["last_updated"] = now.isoformat()
        for k, v in data.items():
            if v is not None:
                merged[k] = v
        get_supabase().table("whoop_cache").upsert(merged, on_conflict="date").execute()


async def _fetch_whoop_window(
    token: str,
    start_dt: datetime,
    end_dt: datetime,
    settings: dict | None = None,
) -> dict[str, dict]:
    start_str = start_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    end_str = end_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    headers = {"Authorization": f"Bearer {token}"}
    by_date: dict[str, dict] = {}

    async with httpx.AsyncClient() as client:
        # Cycles (strain, calories) — map by cycle end date
        try:
            cycle_records = await _whoop_get_records_paginated(
                client,
                "/v2/cycle",
                {"start": start_str, "end": end_str, "limit": 25},
                headers,
            )
            for rec in cycle_records:
                if rec.get("score_state") != "SCORED" or not rec.get("score"):
                    continue
                d = _whoop_record_date(rec, settings=settings)
                if not d:
                    continue
                key = d.isoformat()
                by_date.setdefault(key, {})
                kj = rec["score"].get("kilojoule", 0)
                by_date[key]["strain_score"] = rec["score"].get("strain")
                by_date[key]["calories_burned_kcal"] = round(kj / 4.184, 1) if kj else None
        except Exception as e:
            logger.error(f"Error fetching Whoop cycles: {e}")

        # Recovery — map by start date and fallback to created/updated date
        try:
            recovery_records = await _whoop_get_records_paginated(
                client,
                "/v2/recovery",
                {"start": start_str, "end": end_str, "limit": 25},
                headers,
            )
            for rec in recovery_records:
                if rec.get("score_state") != "SCORED" or not rec.get("score"):
                    continue
                d = _whoop_record_date(rec, settings=settings, use_end=False)
                if not d:
                    d = _as_local_date_from_iso(rec.get("created_at") or rec.get("updated_at"), settings)
                if not d:
                    continue
                key = d.isoformat()
                by_date.setdefault(key, {})
                by_date[key]["recovery_score"] = rec["score"].get("recovery_score")
                by_date[key]["hrv_rmssd"] = rec["score"].get("hrv_rmssd_milli")
                by_date[key]["resting_heart_rate"] = rec["score"].get("resting_heart_rate")
        except Exception as e:
            logger.error(f"Error fetching Whoop recovery: {e}")

        # Sleep — map by sleep end date
        try:
            sleep_records = await _whoop_get_records_paginated(
                client,
                "/v2/activity/sleep",
                {"start": start_str, "end": end_str, "limit": 25},
                headers,
            )
            for rec in sleep_records:
                if rec.get("score_state") != "SCORED" or not rec.get("score"):
                    continue
                d = _whoop_record_date(rec, settings=settings)
                if not d:
                    continue
                key = d.isoformat()
                by_date.setdefault(key, {})
                by_date[key]["sleep_performance_pct"] = rec["score"].get("sleep_performance_percentage")
                s_start, s_end = rec.get("start"), rec.get("end")
                if s_start and s_end:
                    start_t = datetime.fromisoformat(str(s_start).replace("Z", "+00:00"))
                    end_t = datetime.fromisoformat(str(s_end).replace("Z", "+00:00"))
                    by_date[key]["sleep_hours"] = round((end_t - start_t).total_seconds() / 3600, 2)
        except Exception as e:
            logger.error(f"Error fetching Whoop sleep: {e}")

        # Workouts — map by workout end date
        try:
            workout_records = await _whoop_get_records_paginated(
                client,
                "/v2/activity/workout",
                {"start": start_str, "end": end_str, "limit": 25},
                headers,
            )
            for rec in workout_records:
                if rec.get("score_state") != "SCORED" or not rec.get("score"):
                    continue
                d = _whoop_record_date(rec, settings=settings)
                if not d:
                    continue
                key = d.isoformat()
                by_date.setdefault(key, {})
                kj = rec["score"].get("kilojoule", 0)
                by_date[key]["workout_type"] = rec.get("sport_name")
                by_date[key]["workout_strain"] = rec["score"].get("strain")
                by_date[key]["workout_kcal"] = round(kj / 4.184, 1) if kj else None
        except Exception as e:
            logger.error(f"Error fetching Whoop workouts: {e}")

    return by_date


async def sync_whoop_today() -> dict:
    """Sync WHOOP data for recent days. Uses 72h window to capture late-scored recovery/sleep."""
    token = await get_whoop_token()
    if not token:
        return {}

    settings = get_settings()
    now = datetime.now(timezone.utc)
    start_dt = now - timedelta(hours=72)
    by_date = await _fetch_whoop_window(token, start_dt, now, settings=settings)
    _merge_whoop_by_date(by_date, now=now)

    today_str = get_local_today(settings).isoformat()
    return by_date.get(today_str, get_today_whoop_cache() or {})


async def backfill_whoop_history(days: int = 180, chunk_days: int = 7) -> dict:
    """Backfill WHOOP history in chunks for trend analysis."""
    token = await get_whoop_token()
    if not token:
        return {"error": "No valid Whoop token"}

    settings = get_settings()
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=max(1, min(days, 730)))
    chunk_days = max(1, min(chunk_days, 30))
    cursor = start
    chunks = 0
    upserted_dates: set[str] = set()

    while cursor < now:
        end = min(cursor + timedelta(days=chunk_days), now)
        by_date = await _fetch_whoop_window(token, cursor, end, settings=settings)
        _merge_whoop_by_date(by_date, now=now)
        upserted_dates.update(by_date.keys())
        chunks += 1
        cursor = end

    return {
        "status": "backfilled",
        "days_requested": days,
        "chunks_processed": chunks,
        "dates_updated": len(upserted_dates),
        "range_start_utc": start.isoformat(),
        "range_end_utc": now.isoformat(),
    }


async def handle_image_entry(image_data: dict, from_number: str):
    """Called when an image is received. Builds today's context, calls Claude vision, stores pending meal, sends confirmation SMS."""
    if not image_data or not image_data.get("base64") or not image_data.get("content_type"):
        raise ValueError("Invalid image data")

    today = get_local_today()
    try:
        whoop = get_whoop_cache(today)
        food_totals = await get_food_log_totals(today)
        daily_plan = get_today_daily_plan()
        settings = get_settings()
    except Exception as e:
        logger.error(f"Context fetch failed in handle_image_entry: {e}", exc_info=True)
        whoop = None
        food_totals = {"calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0}
        daily_plan = None
        settings = {}

    strain = whoop.get("strain_score", 0) if whoop else 0
    try:
        calorie_target = get_calorie_target(strain, settings)
    except Exception as e:
        logger.warning(f"get_calorie_target failed: {e}")
        calorie_target = 2500

    try:
        memory = get_mem0()
        food_memories_raw = memory.search("preferred foods and typical meals", user_id=USER_ID)
        food_memories = food_memories_raw if isinstance(food_memories_raw, list) else []
        food_memories_str = [m.get("memory", str(m)) for m in food_memories] if food_memories else []
    except Exception as e:
        logger.warning(f"Mem0 search failed in handle_image_entry: {e}")
        food_memories_str = []

    recent_meals = await get_recent_food_log_descriptions(today, limit=3)

    context = {
        "calorie_target": calorie_target,
        "eaten_calories": food_totals.get("calories", 0),
        "eaten_protein": food_totals.get("protein_g", 0),
        "remaining_calories": calorie_target - food_totals.get("calories", 0),
        "protein_target": settings.get("protein_goal_g", 160),
        "carb_target": settings.get("carb_goal_g", 220),
        "fat_target": settings.get("fat_goal_g", 70),
        "food_memories": food_memories_str,
        "recent_meals": recent_meals,
        "recovery_score": whoop.get("recovery_score") if whoop else None,
        "daily_plan": daily_plan,
    }

    try:
        analysis = await analyze_meal_image(
            image_data["base64"],
            image_data["content_type"],
            context,
        )
    except ValueError as e:
        send_sms(to=from_number, body=str(e))
        return
    except Exception as e:
        logger.error(f"analyze_meal_image failed: {type(e).__name__}: {e}", exc_info=True)
        raise

    try:
        await update_conversation_state_by_phone(
            from_number,
            flow="image_confirmation",
            step=1,
            context={"pending_meal": analysis, "from_number": from_number},
        )
    except Exception as e:
        logger.error(f"update_conversation_state_by_phone failed: {e}", exc_info=True)
        raise

    sms = analysis.get(
        "sms_confirmation",
        "I analyzed your meal. Does this look right? Reply YES to log or correct me.",
    )
    send_sms(to=from_number, body=sms)

    log_to_conversation(
        inbound="[Image sent]",
        outbound=sms,
        source="image",
        flow="image_confirmation",
    )

    # Store image analysis in mem0 so preferences/patterns can be learned
    components = analysis.get("components", [])
    meal_desc = ", ".join(c.get("food", "") for c in components) if components else "meal"
    mem0_add([
        {"role": "user", "content": f"[Photo of meal] {meal_desc}"},
        {"role": "assistant", "content": sms},
    ])


async def handle_image_confirmation(
    from_number: str, user_message: str, state_context: dict
) -> str:
    """Handles the YES/correction loop after image analysis. Loops until user confirms, then logs to food_log and clears state."""
    pending_meal = state_context.get("pending_meal")
    if not pending_meal:
        await update_conversation_state_by_phone(from_number, flow="free_chat", step=0, context={})
        return "Something went wrong. Please try sending the photo again."

    user_msg_lower = user_message.lower().strip()

    CANCEL_PHRASES = [
        "cancel", "nevermind", "never mind", "skip", "new meal", "start over",
        "forget it", "no", "nope", "clear", "restart",
    ]
    if any(phrase in user_msg_lower for phrase in CANCEL_PHRASES):
        await update_conversation_state_by_phone(from_number, flow="free_chat", step=0, context={})
        return "Cleared. What would you like to log? (Describe your meal, send a photo, or use voice.)"

    CONFIRM_PHRASES = [
        "yes", "yeah", "yep", "yup", "correct", "right",
        "looks good", "log it", "that's right", "perfect", "ok", "okay", "sure",
    ]

    if any(phrase in user_msg_lower for phrase in CONFIRM_PHRASES):
        totals = pending_meal["totals"]
        meal_type = pending_meal.get("meal_type", "meal")
        components = pending_meal.get("components", [])
        description = ", ".join([c.get("food", "") for c in components if c.get("food")]) if components else pending_meal.get("description", "")

        insert_row = {
            "date": str(get_local_today()),
            "time": get_local_now().strftime("%H:%M:%S"),
            "meal_type": meal_type,
            "description": description,
            "calories": totals["calories"],
            "protein_g": totals["protein_g"],
            "carbs_g": totals["carbs_g"],
            "fat_g": totals["fat_g"],
            "fiber_g": totals.get("fiber_g", 0),
            "sodium_mg": totals.get("sodium_mg", 0),
            "sugar_g": totals.get("sugar_g", 0),
            "source": "image",
        }
        try:
            get_supabase().table("food_log").insert(insert_row).execute()
        except Exception as e:
            logger.warning(f"food_log insert (some columns may not exist): {e}")
            get_supabase().table("food_log").insert({
                "date": insert_row["date"],
                "time": insert_row["time"],
                "description": insert_row["description"],
                "calories": insert_row["calories"],
                "protein_g": insert_row["protein_g"],
                "carbs_g": insert_row["carbs_g"],
                "fat_g": insert_row["fat_g"],
                "source": insert_row["source"],
            }).execute()

        memory = get_mem0()
        memory.add(
            messages=[
                {"role": "user", "content": f"I had {description} for {meal_type}"},
                {"role": "assistant", "content": f"Logged {totals['calories']} kcal, {totals['protein_g']}g protein"},
            ],
            user_id=USER_ID,
        )

        local_today = get_local_today()
        today_totals = await get_food_log_totals(local_today)
        settings = get_settings()
        whoop = get_whoop_cache(local_today)
        strain = whoop.get("strain_score", 0) if whoop else 0
        calorie_target = get_calorie_target(strain, settings)
        remaining = calorie_target - today_totals.get("calories", 0)

        await update_conversation_state_by_phone(from_number, flow="free_chat", step=0, context={})

        flags = pending_meal.get("sports_nutrition_flags", {})
        flag_note = ""
        if flags.get("micronutrient_alerts"):
            flag_note = f" Note: {flags['micronutrient_alerts'][0]}."

        return f"Logged ✓ {totals['calories']} kcal | {totals['protein_g']}g protein | {totals['carbs_g']}g carbs | {totals['fat_g']}g fat. {remaining} kcal remaining today.{flag_note}"

    else:
        try:
            corrected = await apply_meal_correction(user_message, pending_meal)
            await update_conversation_state_by_phone(
                from_number,
                flow="image_confirmation",
                step=1,
                context={**state_context, "pending_meal": corrected},
            )
            return corrected.get("sms_confirmation", "Updated. Does this look right now? Reply YES to log.")
        except Exception as e:
            logger.error(f"apply_meal_correction failed: {e}", exc_info=True)
            await update_conversation_state_by_phone(from_number, flow="free_chat", step=0, context={})
            return "Had trouble with that correction — I've cleared it. Describe your meal in text, send a new photo, or use voice to log."


async def process_message(
    incoming_message: str,
    from_number: str,
    input_source: str = "text",
    transcription_note: str = None,
    image_data: dict = None,
):
    state = await get_conversation_state_by_phone(from_number)
    flow = state.get("flow", "free_chat")
    step = state.get("step", 0)
    context = state.get("context", {})

    if incoming_message == "__IMAGE_MEAL__" and image_data:
        await handle_image_entry(image_data, from_number)
        return

    if flow == "image_confirmation":
        response_text = await handle_image_confirmation(from_number, incoming_message, context)
        send_sms(to=from_number, body=response_text)
        log_to_conversation(
            incoming_message, response_text,
            source=input_source,
            flow="image_confirmation",
        )
        return

    claude_input = incoming_message
    if transcription_note and input_source == "voice":
        claude_input = (
            "[This message was transcribed from a voice note. The user spoke naturally "
            "so interpret it generously — meal descriptions should be parsed as full meal entries.] "
            + incoming_message
        )
    claude_response = build_context_and_call(claude_input)
    process_and_send(claude_response, from_number, flow="free_chat")
    log_to_conversation(incoming_message, claude_response, source=input_source, flow="free_chat")
    mem0_add([{"role": "user", "content": incoming_message}, {"role": "assistant", "content": claude_response}])


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

TONE_PRESETS = {
    "calm_professional": "Communicate in a calm, measured, professional tone. No slang.",
    "friendly": "Communicate like a supportive friend. Casual but never sloppy.",
    "direct": "Be concise and direct. Minimal pleasantries.",
    "coach": "Communicate like a trusted coach. Firm but always encouraging.",
}


def _build_recent_history_section(settings: dict) -> str:
    local_today = get_local_today(settings)
    yesterday = local_today - timedelta(days=1)
    yesterday_str = yesterday.isoformat()
    try:
        result = get_supabase().table("food_log").select("*").eq("date", yesterday_str).execute()
        rows = result.data or []
    except Exception:
        rows = []
    if not rows:
        yesterday_summary = "No food logged yesterday."
    else:
        total_cal = sum(r.get("calories") or 0 for r in rows)
        total_p = sum(float(r.get("protein_g") or 0) for r in rows)
        meals = [r.get("description", "?") for r in rows if r.get("description")]
        yesterday_summary = f"Yesterday: {total_cal} kcal, {round(total_p)}g protein. Meals: {'; '.join(meals[:6])}"
    try:
        week_start = (local_today - timedelta(days=7)).isoformat()
        whoop_rows = (
            get_supabase().table("whoop_cache").select("date,calories_burned_kcal,strain_score")
            .gte("date", week_start).lte("date", local_today.isoformat()).execute()
        ).data or []
    except Exception:
        whoop_rows = []
    if whoop_rows:
        burns = [float(r.get("calories_burned_kcal") or 0) for r in whoop_rows if r.get("calories_burned_kcal")]
        avg_burn = round(sum(burns) / len(burns)) if burns else "N/A"
        avg_strain_vals = [float(r.get("strain_score") or 0) for r in whoop_rows if r.get("strain_score")]
        avg_strain = round(sum(avg_strain_vals) / len(avg_strain_vals), 1) if avg_strain_vals else "N/A"
        week_summary = f"7-day avg burn: {avg_burn} kcal, avg strain: {avg_strain}"
    else:
        week_summary = "No WHOOP data for the past 7 days."
    return f"{yesterday_summary}\n{week_summary}"


def _build_repeat_meal_hints(settings: dict) -> str:
    local_today = get_local_today(settings)
    yesterday = local_today - timedelta(days=1)
    try:
        result = (
            get_supabase().table("food_log").select("meal_type,description,calories,protein_g")
            .eq("date", yesterday.isoformat()).execute()
        )
        rows = result.data or []
    except Exception:
        rows = []
    if not rows:
        return ""
    hints = []
    for r in rows:
        mt = r.get("meal_type", "meal")
        desc = r.get("description", "")
        cal = r.get("calories", 0)
        if desc:
            hints.append(f"{mt}: {desc} ({cal} kcal)")
    if not hints:
        return ""
    return "Yesterday's meals (for repeat suggestions): " + "; ".join(hints[:5])


def build_system_prompt(
    settings: dict,
    whoop_data: dict | None,
    food_rows: list[dict],
    food_totals: dict,
    memories: list,
    daily_plan: dict | None = None,
    daily_metrics: dict | None = None,
) -> str:
    daily_metrics = daily_metrics or build_daily_metrics(settings, food_rows, food_totals, whoop_data)
    strain = whoop_data.get("strain_score") if whoop_data else None
    targets = daily_metrics["targets"]
    remaining = daily_metrics["remaining_calories"]
    goal_mode = settings.get("goal_mode", "maintenance")
    dietary_prefs = settings.get("dietary_preferences", "none")
    pace = daily_metrics["pace_status"]
    local_hour = daily_metrics["local_hour"]
    local_date = daily_metrics["local_date"]
    signals = daily_metrics["meal_signals"]

    tone_key = settings.get("tone", "calm_professional")
    tone_instruction = TONE_PRESETS.get(tone_key, TONE_PRESETS["calm_professional"])

    w = whoop_data or {}
    workout_type = w.get("workout_type", "none")
    workout_strain = w.get("workout_strain", "N/A")
    workout_kcal = w.get("workout_kcal", "N/A")

    food_lines = []
    for r in food_rows:
        components = r.get("components")
        comp_str = ""
        if components and isinstance(components, list):
            comp_parts = [f"  {c.get('food', '?')} ({c.get('amount_g', '?')}g): {c.get('calories', 0)} kcal, "
                          f"{c.get('protein_g', 0)}g P, {c.get('carbs_g', 0)}g C, {c.get('fat_g', 0)}g F"
                          for c in components]
            comp_str = "\n" + "\n".join(comp_parts)
        food_lines.append(
            f"- {r.get('time', '??:??')} [{r.get('meal_type', '')}] {r.get('description', 'unknown')}: "
            f"{r.get('calories', 0)} kcal, {r.get('protein_g', 0)}g P, "
            f"{r.get('carbs_g', 0)}g C, {r.get('fat_g', 0)}g F, "
            f"{r.get('fiber_g', 0)}g fiber{comp_str}"
        )
    food_summary = "\n".join(food_lines) if food_lines else "No food logged yet today."

    meal_plan_str = "Not set"
    if daily_plan and daily_plan.get("meal_plan"):
        mp = daily_plan["meal_plan"]
        meal_plan_str = json.dumps(mp, indent=2) if isinstance(mp, (dict, list)) else str(mp)

    mem_text = "\n".join(m.get("memory", str(m)) for m in memories) if memories else "No memories yet."

    recent_history = _build_recent_history_section(settings)
    repeat_hints = _build_repeat_meal_hints(settings)

    return f"""You are Kyle's personal nutrition coach, a supportive and knowledgeable guide who provides \
helpful advice on food, training nutrition, and habits. You have PhD-level expertise in performance \
nutrition and exercise physiology, but you communicate warmly and directly, without fluff. \
You maintain context across the conversation and react appropriately to ANY prompt: meal logging, \
questions, follow-ups, setbacks, wins, cravings, travel, eating out, or "I'm struggling." \
Always be encouraging and practical. If something is not clear, ask. If he shares a challenge, \
offer specific, actionable support.

TONE: {tone_instruction}
Never make Kyle feel bad about food choices. Frame gaps as opportunities, not failures. \
Avoid cliche fitness or gym-bro language (e.g., "gains", "crushing it", "beast mode", "let's go"). \
Be positive and reassuring without being overly cheerful or performative.

FORMATTING RULES:
- Never use em dashes (the long dash character). Use commas, periods, or semicolons instead.
- Use plain text only. No asterisks, markdown, or formatting (SMS does not support it).

RESPONSE FORMAT RULES (SMS, CRITICAL):
- Every response MUST be under 320 characters total (2 SMS segments max).
- For food logs: show MEAL TOTALS ONLY. Never list per-ingredient breakdowns in the SMS.
- For daily summaries: 3 lines max. Calories, protein, one key insight.
- No bullet points with dashes for ingredient lists.
- No emoji except a single one if needed for tone.
- Never repeat information already sent in this conversation.
- If a detailed breakdown is needed, tell the user to check the app instead.
- When confirming a food log: one line only, e.g. "Logged. Totals: 1840 kcal | 132g P | 210g C | 58g F"

EXAMPLES:
BAD: "BREAKFAST SMOOTHIE:\\n- Banana (120g): 107 kcal | 1g P...\\n- Blueberries (75g)..."
GOOD: "Smoothie logged. Meal: 624 kcal | 59g P | 77g C | 11g F"

BAD: "High strain day, but only 1192 of 2900 kcal landed. Protein at 67g vs 175g target is the biggest gap. Biggest win: solid lunch with 54g protein..."
GOOD: "Day closed: 1192/2900 kcal | 67/175g P. Missed breakfast cost you most. Tomorrow: eat within 30min of waking."

KYLE'S BASELINE PROFILE:
BMR: ~1,700 kcal/day
90-day average burn: ~2,375 kcal/day
Goal mode: {goal_mode}
Dietary preferences: {dietary_prefs}
Health priorities: testosterone and hematocrit support. Under-fueling is a bigger risk \
than over-fueling for Kyle specifically.

STRAIN-BASED DAILY TARGETS:
Low strain (Strain <=7): 2,200 kcal | Protein 150g | Carbs 200g | Fat 70g
Normal (Strain 8-12): 2,500 kcal | Protein 160g | Carbs 230g | Fat 75g
High strain (Strain >=13): 2,900 kcal | Protein 175g | Carbs 280g | Fat 80g
Monster day (Strain 17+): 3,100 kcal. Distribute surplus over next 2 days.
If goal_mode = recomposition: reduce all calorie targets by 175 kcal.

TODAY'S WHOOP DATA:
Date: {local_date}
Strain: {w.get('strain_score', 'N/A')} | Calories burned so far: {w.get('calories_burned_kcal', 'N/A')} kcal
Recovery: {w.get('recovery_score', 'N/A')}% | HRV: {w.get('hrv_rmssd', 'N/A')}ms | RHR: {w.get('resting_heart_rate', 'N/A')}bpm
Sleep performance: {w.get('sleep_performance_pct', 'N/A')}%
Latest workout: {workout_type}, {workout_strain} strain, {workout_kcal} kcal

ACTIVITY-SPECIFIC NUTRITION GUIDANCE:
When workout type is known, adjust recommendations using your exercise physiology expertise:
- Strength/weightlifting/powerlifting: prioritize protein (0.4-0.5g/kg in post-workout meal), moderate carbs for glycogen replenishment.
- Running/cycling/cardio: prioritize carbs (1.0-1.2g/kg post-workout), maintain protein for recovery.
- HIIT/CrossFit/mixed modality: balanced protein and carbs, higher total calorie allocation.
- Yoga/mobility/light activity: no special macro adjustment needed.
These are guidelines. Use your expertise to calibrate based on intensity, duration, and Kyle's current state.

TODAY'S NUTRITION:
Meal plan for today: {meal_plan_str}
Logged so far: {food_totals['calories']} kcal | Protein: {food_totals['protein_g']}g | \
Carbs: {food_totals['carbs_g']}g | Fat: {food_totals['fat_g']}g | Fiber: {food_totals['fiber_g']}g
Today's target: {targets['calories']} kcal | Remaining: {remaining} kcal
Nutrition pace: {pace} (on track / behind / ahead)
Expected by this hour ({local_hour}:00 local): {daily_metrics['expected_calories_by_now']} kcal | Delta vs pace: {daily_metrics['delta_vs_pace']} kcal
Meal logging signals: missed_breakfast={signals['missed_breakfast']}, missed_lunch={signals['missed_lunch']}, long_gap_since_meal={signals['long_gap_since_meal']}

{food_summary}

RECENT HISTORY:
{recent_history}
{repeat_hints}

RELEVANT MEMORIES:
{mem_text}

INSTRUCTIONS:
- Track and flag micronutrient status: iron, calcium, potassium, vitamin D, magnesium, zinc, and B12 are critical for Kyle's testosterone and hematocrit priorities. Estimate values and flag likely deficiencies.
- When suggesting food changes, be specific and simple: "add 30g of almonds" not "eat more healthy fats".
- All meal suggestions must reference Kyle's known food preferences and past meals from memories. If suggesting something new, acknowledge it.
- When checking in, proactively suggest re-logging a previous similar meal if that meal type has not been logged today. Adjust portions based on today's activity level compared to when the meal was originally eaten.
- When you detect a recurring issue (e.g. low protein at lunch 3 days running), name it directly.
- Append structured meal data after any food log in this exact format, on its own line:
  <meal>{{"meal_type": "lunch", "calories": 650, "protein_g": 45, "carbs_g": 60, "fat_g": 18, \
"fiber_g": 8, "sodium_mg": 420, "sugar_g": 12, \
"iron_mg": 3.2, "calcium_mg": 80, "potassium_mg": 450, "vitamin_d_mcg": 0, \
"magnesium_mg": 55, "zinc_mg": 4.1, "b12_mcg": 1.2, \
"components": [{{"food": "chicken breast", "amount_g": 150, "calories": 250, "protein_g": 45, "carbs_g": 0, "fat_g": 5}}, \
{{"food": "white rice", "amount_g": 200, "calories": 260, "protein_g": 5, "carbs_g": 58, "fat_g": 1}}], \
"description": "chicken rice bowl with veg"}}</meal>
- Never make the <meal> tag visible in your response to the user. It is parsed silently.
- If Kyle asks about what he ate yesterday, previous days, or his typical calorie burn patterns, use the RECENT HISTORY section above to answer accurately."""


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
        logger.info(f"Mem0 add OK for user_id={USER_ID}")
    except Exception as e:
        logger.error(f"Mem0 add failed: {e}", exc_info=True)

# ---------------------------------------------------------------------------
# Claude call helper
# ---------------------------------------------------------------------------

def call_claude(system_prompt: str, user_message: str, conversation_history: list[dict] | None = None) -> str:
    messages = []
    if conversation_history:
        messages.extend(conversation_history)
    messages.append({"role": "user", "content": user_message})
    response = get_claude().messages.create(
        model="claude-opus-4-6",
        max_tokens=1024,
        system=system_prompt,
        messages=messages,
    )
    return response.content[0].text


def build_context_and_call(user_message: str, extra_mem_query: str | None = None) -> str:
    """Full context build + Claude call. Returns raw Claude response. Uses multi-turn history."""
    settings = get_settings()
    food_rows, food_totals = get_today_food_log()
    whoop_data = get_today_whoop_cache()
    daily_plan = get_today_daily_plan()
    daily_metrics = build_daily_metrics(settings, food_rows, food_totals, whoop_data)
    base_query = "food preferences meal history calorie patterns"
    query = f"{base_query} {extra_mem_query or user_message}"
    memories = mem0_search(query)
    system_prompt = build_system_prompt(
        settings, whoop_data, food_rows, food_totals, memories, daily_plan, daily_metrics=daily_metrics
    )
    history = get_recent_conversation(limit=20, exclude_last_inbound=True)
    return call_claude(system_prompt, user_message, conversation_history=history)


def process_and_send(claude_response: str, to: str, flow: str | None = None, proactive: bool = False) -> str:
    """Parse meal tags, log food, send SMS, log conversation. Returns clean message."""
    clean_message, meal_data = parse_meal_data(claude_response)
    if meal_data:
        try:
            log_food(meal_data)
        except Exception as e:
            logger.error(f"Failed to log food: {e}")
    try:
        send_sms(to=to, body=clean_message, proactive=proactive)
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
    end_date = get_local_today()
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
    cals_by_date_and_hour: dict[str, dict[int, float]] = {}
    protein_meals_by_date: dict[str, list[float]] = {}
    first_meal_hours: list[float] = []
    missed_breakfast_days = 0
    missed_lunch_days = 0
    long_gap_days = 0
    date_to_times: dict[str, list[dt_time]] = {}
    for row in food_rows:
        d = row.get("date", "")
        daily_cals[d] = daily_cals.get(d, 0) + (row.get("calories") or 0)
        daily_protein[d] = daily_protein.get(d, 0) + float(row.get("protein_g") or 0)
        desc = row.get("description", "").lower()
        meal_type = row.get("meal_type", "unknown")
        key = f"{meal_type}:{desc}"
        food_counts[key] = food_counts.get(key, 0) + 1
        t = _parse_hms(row.get("time"))
        if t:
            date_to_times.setdefault(d, []).append(t)
            cals_by_date_and_hour.setdefault(d, {})
            cals_by_date_and_hour[d][t.hour] = cals_by_date_and_hour[d].get(t.hour, 0.0) + float(row.get("calories") or 0)
        protein_meals_by_date.setdefault(d, []).append(float(row.get("protein_g") or 0))

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

    late_calorie_loading_pct_by_day = []
    protein_frontload_ratio_by_day = []
    for d, day_total in daily_cals.items():
        times = sorted(date_to_times.get(d, []))
        if times:
            first_meal_hours.append(times[0].hour + times[0].minute / 60)
            has_breakfast = any(t.hour < 11 for t in times)
            has_lunch = any(11 <= t.hour < 16 for t in times)
            if not has_breakfast:
                missed_breakfast_days += 1
            if not has_lunch:
                missed_lunch_days += 1
            max_gap = 0.0
            for i in range(1, len(times)):
                prev = times[i - 1]
                cur = times[i]
                prev_h = prev.hour + prev.minute / 60
                cur_h = cur.hour + cur.minute / 60
                max_gap = max(max_gap, cur_h - prev_h)
            if max_gap >= 6:
                long_gap_days += 1
        late_cal = sum(v for h, v in cals_by_date_and_hour.get(d, {}).items() if h >= 20)
        if day_total:
            late_calorie_loading_pct_by_day.append((late_cal / day_total) * 100)
        proteins = protein_meals_by_date.get(d, [])
        if proteins and sum(proteins) > 0:
            morning_protein = 0.0
            for idx, p in enumerate(proteins):
                if idx < 2:
                    morning_protein += p
            protein_frontload_ratio_by_day.append((morning_protein / sum(proteins)) * 100)

    meal_timing_std_hours = None
    if len(first_meal_hours) >= 2:
        avg_first = sum(first_meal_hours) / len(first_meal_hours)
        variance = sum((h - avg_first) ** 2 for h in first_meal_hours) / len(first_meal_hours)
        meal_timing_std_hours = round(variance ** 0.5, 2)

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
        "behavior_trends": {
            "late_calorie_loading_pct_avg": round(sum(late_calorie_loading_pct_by_day) / len(late_calorie_loading_pct_by_day), 1)
            if late_calorie_loading_pct_by_day else None,
            "missed_breakfast_days": missed_breakfast_days,
            "missed_lunch_days": missed_lunch_days,
            "long_gap_days": long_gap_days,
            "first_meal_timing_std_hours": meal_timing_std_hours,
            "protein_frontload_pct_avg": round(sum(protein_frontload_ratio_by_day) / len(protein_frontload_ratio_by_day), 1)
            if protein_frontload_ratio_by_day else None,
        },
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
        existing_plan = get_today_daily_plan()
        if existing_plan and existing_plan.get("plan_confirmed"):
            logger.info("Morning plan already confirmed for today, skipping")
            return
        memories = mem0_search("training schedule preferences typical morning routine")
        settings = get_settings()
        whoop_data = get_today_whoop_cache()
        food_rows, food_totals = get_today_food_log()
        daily_metrics = build_daily_metrics(settings, food_rows, food_totals, whoop_data)
        system_prompt = build_system_prompt(settings, whoop_data, food_rows, food_totals, memories, daily_metrics=daily_metrics)
        claude_msg = call_claude(
            system_prompt,
            "Generate Kyle's morning brief. Include: recovery score interpretation, HRV context "
            "vs his baseline, sleep quality, and a suggested effort level for today "
            "(Easy / Moderate / Hard / Rest) with a one-sentence rationale. Then ask one question: "
            "'Training today?' Keep it under 300 characters total. Be direct and warm."
        )
        process_and_send(claude_msg, OWNER_PHONE_NUMBER, flow="morning_planning", proactive=True)
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
            send_sms(OWNER_PHONE_NUMBER, "What and when?", proactive=True)
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

        daily_metrics = build_daily_metrics(settings, food_rows, food_totals, whoop_data)
        system_prompt = build_system_prompt(
            settings, whoop_data, food_rows, food_totals, memories, daily_plan, daily_metrics=daily_metrics
        )
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
        clean = process_and_send(claude_msg, OWNER_PHONE_NUMBER, flow="morning_planning", proactive=True)

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
            send_sms(OWNER_PHONE_NUMBER, "Plan locked. I'll check in at noon. 💪", proactive=True)
            log_conversation("outbound", "Plan locked. I'll check in at noon. 💪", flow="morning_planning")
            set_conversation_state("free_chat", step=0)
        else:
            memories = mem0_search("food preferences")
            settings = get_settings()
            whoop_data = get_today_whoop_cache()
            food_rows, food_totals = get_today_food_log()
            daily_plan = get_today_daily_plan()
            daily_metrics = build_daily_metrics(settings, food_rows, food_totals, whoop_data)
            system_prompt = build_system_prompt(
                settings, whoop_data, food_rows, food_totals, memories, daily_plan, daily_metrics=daily_metrics
            )
            claude_msg = call_claude(
                system_prompt,
                f"Kyle wants changes to his meal plan. His request: '{user_message}'. "
                f"Regenerate the affected meals, keeping the rest. Show updated plan. "
                f"Ask him to confirm again."
            )
            clean = process_and_send(claude_msg, OWNER_PHONE_NUMBER, flow="morning_planning", proactive=True)
            try:
                upsert_daily_plan({"meal_plan": {"raw_plan": clean}})
            except Exception as e:
                logger.error(f"Failed to update meal plan: {e}")


async def handle_midday_checkin() -> str:
    await sync_whoop_today()
    memories = mem0_search("lunch preferences typical lunch breakfast habits")
    settings = get_settings()
    food_rows, food_totals = get_today_food_log()
    whoop_data = get_today_whoop_cache()
    daily_plan = get_today_daily_plan()
    daily_metrics = build_daily_metrics(settings, food_rows, food_totals, whoop_data)
    system_prompt = build_system_prompt(
        settings, whoop_data, food_rows, food_totals, memories, daily_plan, daily_metrics=daily_metrics
    )
    targets = daily_metrics["targets"]
    pace_target = daily_metrics["expected_calories_by_now"]
    signals = daily_metrics["meal_signals"]

    claude_msg = call_claude(
        system_prompt,
        f"Generate Kyle's midday check-in. Reference his morning plan. Show: calories eaten "
        f"({food_totals['calories']}) vs pace target ({round(pace_target)}), protein tracking "
        f"({food_totals['protein_g']}g / {targets['protein_g']}g). Identify the most important "
        f"gap right now. Suggest one specific adjustment to lunch based on where he's at. "
        f"Current pace status is {daily_metrics['pace_status']} with delta {daily_metrics['delta_vs_pace']} kcal. "
        f"Breakfast logged={signals['breakfast_logged']}. Ask if he's logged everything. "
        f"Under 320 characters."
    )
    return process_and_send(claude_msg, OWNER_PHONE_NUMBER, flow="midday_checkin", proactive=True)


async def handle_evening_checkin() -> str:
    await sync_whoop_today()
    memories = mem0_search("dinner preferences evening eating patterns typical dinner")
    settings = get_settings()
    food_rows, food_totals = get_today_food_log()
    whoop_data = get_today_whoop_cache()
    daily_plan = get_today_daily_plan()
    daily_metrics = build_daily_metrics(settings, food_rows, food_totals, whoop_data)
    system_prompt = build_system_prompt(
        settings, whoop_data, food_rows, food_totals, memories, daily_plan, daily_metrics=daily_metrics
    )
    targets = daily_metrics["targets"]
    remaining = daily_metrics["remaining_calories"]
    signals = daily_metrics["meal_signals"]

    claude_msg = call_claude(
        system_prompt,
        f"Generate Kyle's 6pm check-in. Show calories remaining ({remaining}) vs target "
        f"({targets['calories']}). Assess if he's on track. If behind: suggest a specific dinner "
        f"adjustment to close the gap (e.g. 'add 40g extra rice and another chicken breast'). "
        f"If ahead: suggest a lighter dinner option. Missing lunch={signals['missed_lunch']}, long_gap={signals['long_gap_since_meal']}. "
        f"Check if any meals appear unlogged. "
        f"Ask if he trained as planned. Under 320 characters."
    )
    return process_and_send(claude_msg, OWNER_PHONE_NUMBER, flow="evening_checkin", proactive=True)


async def handle_post_workout(workout_data: dict | None = None) -> str:
    daily_plan = get_today_daily_plan()
    whoop_data = get_today_whoop_cache()
    memories = mem0_search("post-workout nutrition habits")
    settings = get_settings()
    food_rows, food_totals = get_today_food_log()
    daily_metrics = build_daily_metrics(settings, food_rows, food_totals, whoop_data)
    system_prompt = build_system_prompt(
        settings, whoop_data, food_rows, food_totals, memories, daily_plan, daily_metrics=daily_metrics
    )

    w = workout_data or whoop_data or {}
    sport = w.get("workout_type") or w.get("sport_name", "workout")
    w_strain = w.get("workout_strain") or w.get("strain", "N/A")
    w_kcal = w.get("workout_kcal", "N/A")
    total_burn = whoop_data.get("calories_burned_kcal", "N/A") if whoop_data else "N/A"

    remaining = daily_metrics["remaining_calories"]

    claude_msg = call_claude(
        system_prompt,
        f"Generate a post-workout message for Kyle. His {sport} just synced from WHOOP — {w_strain} strain, "
        f"{w_kcal} kcal burned. Total burn today: {total_burn}. "
        f"REAL-TIME ADJUSTMENT: He should add {remaining} kcal to his remaining meals today. "
        f"Tell him exactly what to eat in the next 45 min (specific foods, grams of protein and carbs). "
        f"Reference his usual post-workout habits from memories if known. "
        f"End with asking what he had. Under 320 characters."
    )
    return process_and_send(claude_msg, OWNER_PHONE_NUMBER, flow="post_workout", proactive=True)


async def handle_night_summary() -> str:
    await sync_whoop_today()
    memories = mem0_search("weekly_pattern monthly_pattern food preferences calorie patterns")
    settings = get_settings()
    food_rows, food_totals = get_today_food_log()
    whoop_data = get_today_whoop_cache()
    daily_plan = get_today_daily_plan()
    daily_metrics = build_daily_metrics(settings, food_rows, food_totals, whoop_data)
    system_prompt = build_system_prompt(
        settings, whoop_data, food_rows, food_totals, memories, daily_plan, daily_metrics=daily_metrics
    )

    strain = whoop_data.get("strain_score") if whoop_data else None
    targets = daily_metrics["targets"]

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
    clean = process_and_send(claude_msg, OWNER_PHONE_NUMBER, flow="night_summary", proactive=True)

    local_today = get_local_today(settings)
    mem0_add([
        {"role": "user", "content": f"Day summary {local_today.isoformat()}: ate {food_totals['calories']} kcal, "
         f"{food_totals['protein_g']}g protein, strain {strain}"},
        {"role": "assistant", "content": claude_msg},
    ])

    today = local_today
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

def _format_image_error(e: Exception) -> str:
    """Format error for SMS - always include type for debugging."""
    err_type = type(e).__name__
    err_str = str(e).replace("\n", " ")[:60]
    return f"Couldn't process that photo ({err_type}: {err_str}). Try again or describe your meal in text."


async def process_sms_webhook(
    incoming_message: str,
    from_number: str,
    num_media: int = 0,
    media_content_type: str = "",
    media_url: str = "",
):
    """Process inbound SMS in the background (including transcription)."""
    def _send_error(body: str):
        try:
            send_sms(to=from_number, body=body[:300])
        except Exception as sms_err:
            logger.error(f"Failed to send error SMS: {sms_err}")

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
            if not media_url or not media_url.startswith("http"):
                logger.error("Image media URL missing or invalid")
                _send_error("Couldn't process that photo (no media URL). Try again or describe your meal in text.")
                return
            try:
                logger.info(f"Downloading image from {media_url[:80]}...")
                async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                    img_response = await client.get(
                        media_url,
                        auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
                    )
                    img_response.raise_for_status()
                    image_bytes = img_response.content
                    image_base64 = base64.b64encode(image_bytes).decode("utf-8")
                content_type = media_content_type.split(";")[0].strip() or "image/jpeg"
                if not content_type.startswith("image/"):
                    content_type = "image/jpeg"
                image_data = {"base64": image_base64, "content_type": content_type}
                logger.info(f"Image downloaded: {len(image_bytes)} bytes, type={content_type}")
                await process_message("__IMAGE_MEAL__", from_number, input_source="image", image_data=image_data)
                return
            except httpx.HTTPStatusError as e:
                logger.error(f"Image download HTTP error: {e.response.status_code} {e.response.text[:200]}")
                _send_error(f"Couldn't download photo (HTTP {e.response.status_code}). Try again or describe your meal.")
                return
            except Exception as e:
                logger.error(f"Image download/analysis failed: {type(e).__name__}: {e}", exc_info=True)
                _send_error(_format_image_error(e))
                return

        elif num_media > 0 and media_content_type:
            try:
                send_sms(to=from_number, body="I can only process voice notes and text right now. Describe your meal by voice or text.")
            except Exception as e:
                logger.error(f"Failed to send unsupported media SMS: {e}")
            return

        if not incoming_message:
            logger.warning(f"No message content from {from_number}, skipping")
            return

        # Check if user is in image confirmation flow (reply to photo analysis)
        try:
            phone_state = await get_conversation_state_by_phone(from_number)
            if phone_state.get("flow") == "image_confirmation":
                await process_message(incoming_message, from_number, input_source=source)
                return
        except Exception as e:
            logger.error(f"Image confirmation check failed: {e}", exc_info=True)

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
            last_updated = state.get("last_updated")
            stale = False
            if last_updated:
                try:
                    lu = datetime.fromisoformat(str(last_updated).replace("Z", "+00:00"))
                    if lu.tzinfo is None:
                        lu = lu.replace(tzinfo=timezone.utc)
                    stale = (datetime.now(timezone.utc) - lu).total_seconds() > 7200
                except (ValueError, TypeError):
                    pass
            if stale:
                logger.info("Morning planning state stale (>2h), resetting to free_chat")
                set_conversation_state("free_chat", step=0)
            else:
                food_keywords = ["i had", "i ate", "i just had", "just ate", "log ", "for breakfast",
                                 "for lunch", "for dinner", "for snack", "smoothie", "protein shake",
                                 "oats", "eggs", "chicken", "rice", "salad", "coffee"]
                msg_lower = claude_input.lower().strip()
                is_food_log = any(kw in msg_lower for kw in food_keywords)
                if not is_food_log:
                    await handle_morning_planning(step, context, user_message=claude_input)
                    mem0_add([{"role": "user", "content": incoming_message}])
                    return

        last_err = None
        for _attempt in range(2):
            try:
                claude_response = build_context_and_call(claude_input)
                clean_message = process_and_send(claude_response, from_number, flow="free_chat")
                last_err = None
                break
            except Exception as e:
                last_err = e
                logger.warning(f"Claude/send attempt {_attempt + 1} failed: {e}")
                if _attempt == 0:
                    await asyncio.sleep(1)

        if last_err:
            raise last_err

        try:
            log_conversation("inbound", log_msg, flow="free_chat", source=source)
        except Exception as e:
            logger.error(f"Failed to log conversation: {e}")

        mem0_add([
            {"role": "user", "content": incoming_message},
            {"role": "assistant", "content": claude_response},
        ])
    except Exception as e:
        logger.error(f"SMS processing error: {type(e).__name__}: {e}", exc_info=True)
        try:
            send_sms(to=from_number, body=f"Something went wrong ({type(e).__name__}). Please try again.")
        except Exception as sms_err:
            logger.critical(f"TOTAL FAILURE: could not send error SMS to {from_number}: {sms_err}")


def _event_nudge_allowed(event_type: str, settings: dict, cooldown_minutes: int = 90) -> bool:
    """Throttle proactive WHOOP nudges to avoid SMS spam."""
    now_local = get_local_now(settings)
    day_str = now_local.date().isoformat()
    try:
        result = (
            get_supabase().table("whoop_event_nudges").select("*")
            .eq("event_type", event_type)
            .eq("date", day_str)
            .limit(1)
            .execute()
        )
        row = result.data[0] if result.data else None
        if row and row.get("last_sent_at"):
            sent_at = datetime.fromisoformat(str(row["last_sent_at"]).replace("Z", "+00:00"))
            if sent_at.tzinfo is None:
                sent_at = sent_at.replace(tzinfo=timezone.utc)
            mins = (datetime.now(timezone.utc) - sent_at.astimezone(timezone.utc)).total_seconds() / 60
            if mins < cooldown_minutes:
                return False
        get_supabase().table("whoop_event_nudges").upsert({
            "event_type": event_type,
            "date": day_str,
            "last_sent_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="event_type,date").execute()
        return True
    except Exception as e:
        logger.warning(f"whoop_event_nudges unavailable, using permissive fallback: {e}")
        return True


async def handle_sleep_update_nudge() -> str:
    settings = get_settings()
    food_rows, food_totals = get_today_food_log()
    whoop_data = get_today_whoop_cache()
    daily_plan = get_today_daily_plan()
    memories = mem0_search("sleep nutrition recovery habits")
    daily_metrics = build_daily_metrics(settings, food_rows, food_totals, whoop_data)
    system_prompt = build_system_prompt(
        settings, whoop_data, food_rows, food_totals, memories, daily_plan, daily_metrics=daily_metrics
    )
    claude_msg = call_claude(
        system_prompt,
        f"WHOOP sleep just synced. Send a proactive nudge based on sleep performance ({whoop_data.get('sleep_performance_pct') if whoop_data else 'N/A'}), "
        f"recovery ({whoop_data.get('recovery_score') if whoop_data else 'N/A'}) and today's pace ({daily_metrics['pace_status']}). "
        "Give one concrete behavior for the next meal. Ask one quick confirmation question. Under 300 characters.",
    )
    return process_and_send(claude_msg, OWNER_PHONE_NUMBER, flow="sleep_update", proactive=True)


async def handle_recovery_update_nudge() -> str:
    settings = get_settings()
    food_rows, food_totals = get_today_food_log()
    whoop_data = get_today_whoop_cache()
    daily_plan = get_today_daily_plan()
    memories = mem0_search("recovery fueling training readiness")
    daily_metrics = build_daily_metrics(settings, food_rows, food_totals, whoop_data)
    system_prompt = build_system_prompt(
        settings, whoop_data, food_rows, food_totals, memories, daily_plan, daily_metrics=daily_metrics
    )
    claude_msg = call_claude(
        system_prompt,
        f"WHOOP recovery just updated. Send a proactive nudge using recovery ({whoop_data.get('recovery_score') if whoop_data else 'N/A'}) "
        f"and today's remaining calories ({daily_metrics['remaining_calories']}). "
        "Set effort expectation for the day and one specific nutrition action. Under 300 characters.",
    )
    return process_and_send(claude_msg, OWNER_PHONE_NUMBER, flow="recovery_update", proactive=True)


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

        settings = get_settings()

        if event_type == "recovery.updated":
            await sync_whoop_today()
            hour = get_local_now(settings).hour
            existing_plan = get_today_daily_plan()
            if 5 <= hour <= 10 and not (existing_plan and existing_plan.get("plan_confirmed")):
                await handle_morning_planning(0, {})
            if _event_nudge_allowed(event_type, settings, cooldown_minutes=120):
                await handle_recovery_update_nudge()

        elif event_type == "workout.updated":
            await sync_whoop_today()
            workout = await fetch_workout_by_id(event_id) if event_id else None
            if workout and workout.get("score_state") == "SCORED" and workout.get("score"):
                kj = workout["score"].get("kilojoule", 0)
                workout_info = {
                    "workout_type": workout.get("sport_name"),
                    "workout_strain": workout["score"].get("strain"),
                    "workout_kcal": round(kj / 4.184, 1) if kj else None,
                }
                if _event_nudge_allowed(event_type, settings, cooldown_minutes=75):
                    await handle_post_workout(workout_info)
            # Do not send a post-workout nudge when workout is not yet scored or missing; avoids "no workout synced" confusion

        elif event_type == "sleep.updated":
            await sync_whoop_today()
            if _event_nudge_allowed(event_type, settings, cooldown_minutes=120):
                await handle_sleep_update_nudge()

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


@app.post("/api/food")
async def api_food(request: Request):
    """Accept food description from the Moment app; parse with Claude, log to food_log."""
    body = await request.json()
    description = (body.get("description") or "").strip()
    if not description:
        return JSONResponse(status_code=400, content={"error": "description required"})
    try:
        response = build_context_and_call(description)
    except Exception as e:
        logger.error(f"api_food build_context_and_call failed: {e}", exc_info=True)
        return JSONResponse(status_code=500, content={"error": str(e)})
    clean_message, meal_data = parse_meal_data(response)
    if meal_data:
        meal_data["source"] = "app"
        try:
            log_food(meal_data)
        except Exception as e:
            logger.error(f"api_food log_food failed: {e}")
        mem0_add([
            {"role": "user", "content": f"Log: {description}"},
            {"role": "assistant", "content": clean_message},
        ])
        return {"message": clean_message, "logged": meal_data}
    mem0_add([
        {"role": "user", "content": description},
        {"role": "assistant", "content": clean_message},
    ])
    return {"message": clean_message}


@app.post("/api/food/image")
async def api_food_image(
    file: UploadFile = File(...),
    phone: str = Form(default="__app_user__"),
):
    image_bytes = await file.read()
    if not (file.content_type or "").startswith("image/"):
        return JSONResponse(status_code=400, content={"error": "image required"})

    image_base64 = base64.b64encode(image_bytes).decode("utf-8")

    today = get_local_today()
    whoop = get_whoop_cache(today)
    food_totals = await get_food_log_totals(today)
    daily_plan = get_today_daily_plan()
    settings = get_settings()
    strain = whoop.get("strain_score", 0) if whoop else 0
    calorie_target = get_calorie_target(strain, settings)
    recent_meals = await get_recent_food_log_descriptions(today, limit=3)
    context = {
        "calorie_target": calorie_target,
        "eaten_calories": food_totals.get("calories", 0),
        "eaten_protein": food_totals.get("protein_g", 0),
        "remaining_calories": calorie_target - food_totals.get("calories", 0),
        "protein_target": settings.get("protein_goal_g", 160),
        "carb_target": settings.get("carb_goal_g", 220),
        "fat_target": settings.get("fat_goal_g", 70),
        "food_memories": [],
        "recent_meals": recent_meals,
        "recovery_score": whoop.get("recovery_score") if whoop else None,
        "daily_plan": daily_plan,
    }

    try:
        analysis = await analyze_meal_image(
            image_base64,
            file.content_type,
            context,
        )
    except ValueError as e:
        return JSONResponse(status_code=422, content={"error": str(e)})
    except Exception as e:
        logger.error(f"api_food_image analyze failed: {e}", exc_info=True)
        return JSONResponse(status_code=500, content={"error": str(e)})

    await update_conversation_state_by_phone(
        phone,
        flow="image_confirmation",
        step=1,
        context={"pending_meal": analysis, "from_number": phone},
    )

    return {
        "sms_confirmation": analysis.get("sms_confirmation", ""),
        "analysis": {
            "components": analysis.get("components", []),
            "totals": analysis.get("totals", {}),
            "meal_type": analysis.get("meal_type", ""),
            "overall_confidence": analysis.get("overall_confidence", ""),
        },
        "pending_id": phone,
    }


@app.post("/api/food/image/confirm")
async def api_food_image_confirm(request: Request):
    body = await request.json()
    phone = body.get("phone", "")
    confirmed = body.get("confirmed", False)
    correction = body.get("correction", "").strip()

    state = await get_conversation_state_by_phone(phone)
    if state.get("flow") != "image_confirmation":
        return JSONResponse(status_code=400, content={"error": "no pending image"})

    pending_meal = state.get("context", {}).get("pending_meal")
    if not pending_meal:
        return JSONResponse(status_code=400, content={"error": "no pending meal"})

    if correction and (not confirmed):
        try:
            updated = await apply_meal_correction(correction, pending_meal)
            await update_conversation_state_by_phone(
                phone,
                flow="image_confirmation",
                step=1,
                context={"pending_meal": updated, "from_number": phone},
            )
            return {
                "status": "corrected",
                "sms_confirmation": updated.get("sms_confirmation", ""),
                "analysis": {
                    "components": updated.get("components", []),
                    "totals": updated.get("totals", {}),
                    "meal_type": updated.get("meal_type", ""),
                },
            }
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e)})

    if confirmed:
        totals = pending_meal["totals"]
        components = pending_meal.get("components", [])
        description = ", ".join([c.get("food", "") for c in components if c.get("food")]) or "meal"
        meal_type = pending_meal.get("meal_type", "meal")
        insert_row = {
            "date": str(get_local_today()),
            "time": get_local_now().strftime("%H:%M:%S"),
            "meal_type": meal_type,
            "description": description,
            "calories": totals["calories"],
            "protein_g": totals["protein_g"],
            "carbs_g": totals["carbs_g"],
            "fat_g": totals["fat_g"],
            "fiber_g": totals.get("fiber_g", 0),
            "sodium_mg": totals.get("sodium_mg", 0),
            "sugar_g": totals.get("sugar_g", 0),
            "source": "app_image",
        }
        get_supabase().table("food_log").insert(insert_row).execute()
        await update_conversation_state_by_phone(phone, flow="free_chat", step=0, context={})
        today_totals = await get_food_log_totals(get_local_today())
        remaining = calorie_target - today_totals.get("calories", 0) if (
            calorie_target := get_calorie_target(
                get_whoop_cache(get_local_today()).get("strain_score") if get_whoop_cache(get_local_today()) else None,
                get_settings()
            )
        ) else 2500 - today_totals.get("calories", 0)
        return {
            "status": "logged",
            "logged": insert_row,
            "message": f"Logged ✓ {totals['calories']} kcal · {totals['protein_g']}g protein · {remaining} kcal remaining today",
        }

    return {"status": "pending"}


@app.post("/api/food/voice")
async def api_food_voice(file: UploadFile = File(...)):
    audio_bytes = await file.read()
    content_type = file.content_type or "audio/m4a"

    try:
        openai_client = openai.OpenAI(api_key=OPENAI_API_KEY)
        ext = AUDIO_EXTENSION_MAP.get(content_type.split(";")[0].strip(), "m4a")
        filename = f"audio.{ext}"
        transcript = openai_client.audio.transcriptions.create(
            model="whisper-1",
            file=(filename, audio_bytes, "audio/mpeg"),
            prompt="This is a meal description for nutrition tracking.",
        )
        transcribed_text = transcript.text
    except Exception as e:
        logger.error(f"api_food_voice transcription failed: {e}", exc_info=True)
        return JSONResponse(status_code=500, content={"error": str(e)})

    try:
        claude_input = (
            "[This message was transcribed from a voice note. Parse it as a meal entry.] "
            + transcribed_text
        )
        response = build_context_and_call(claude_input)
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

    clean_message, meal_data = parse_meal_data(response)
    if meal_data:
        meal_data["source"] = "app_voice"
        try:
            log_food(meal_data)
        except Exception as e:
            logger.error(f"api_food_voice log_food failed: {e}")
        return {
            "transcription": transcribed_text,
            "message": clean_message,
            "logged": meal_data,
        }

    return {
        "transcription": transcribed_text,
        "message": clean_message,
    }


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
        logger.warning("WHOOP sync returned empty; token may need re-auth at /auth/whoop")
        return {"status": "degraded", "error": "No valid Whoop token", "data": {}}
    return {"status": "synced", "data": data}


@app.post("/sync/whoop/backfill")
async def sync_whoop_backfill(
    request: Request,
    days: int = 180,
    chunk_days: int = 7,
):
    header_token = request.headers.get("X-Admin-Token", "")
    if SYNC_ADMIN_TOKEN and header_token != SYNC_ADMIN_TOKEN:
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    if days < 1 or days > 730:
        return JSONResponse(status_code=400, content={"error": "days must be between 1 and 730"})
    result = await backfill_whoop_history(days=days, chunk_days=chunk_days)
    if result.get("error"):
        return JSONResponse(status_code=401, content=result)
    return result


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


@app.get("/webhook/whoop")
async def webhook_whoop_get():
    """GET returns a helpful message; WHOOP sends POST with event payloads."""
    return {"status": "ok", "message": "WHOOP webhooks require POST. Configure this URL in WHOOP Developer Dashboard with events: workout.updated, recovery.updated, sleep.updated."}


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


@app.get("/debug/mem0")
async def debug_mem0():
    """List memories for user_id=kyle to verify mem0 is capturing data."""
    try:
        memory = get_mem0()
        # Broad search to get recent memories
        result = memory.search(
            query="food preferences meals training schedule goals",
            user_id=USER_ID,
        )
        memories = result if isinstance(result, list) else []
        return {
            "user_id": USER_ID,
            "count": len(memories),
            "memories": [
                {"memory": m.get("memory", str(m)), "metadata": m.get("metadata", {})}
                for m in memories
            ],
        }
    except Exception as e:
        logger.error(f"debug_mem0 failed: {e}", exc_info=True)
        return {"error": str(e), "type": type(e).__name__}


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
