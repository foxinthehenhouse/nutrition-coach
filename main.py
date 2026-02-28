import os
import re
import json
import base64
import logging
from datetime import datetime, timezone, date, time as dt_time
from urllib.parse import urlencode, urlparse

import httpx
import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Form, Response, BackgroundTasks
from fastapi.responses import JSONResponse, RedirectResponse
from supabase import create_client, Client
from twilio.rest import Client as TwilioClient
from mem0 import Memory

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Nutrition Coach SMS Bot")

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

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
twilio_client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
claude_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

USER_ID = "kyle"


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
    result = supabase.table("settings").select("*").execute()
    return {row["key"]: row["value"] for row in result.data}


def get_today_food_log() -> tuple[list[dict], dict]:
    today_str = date.today().isoformat()
    result = (
        supabase.table("food_log")
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
    return get_whoop_cache(date.today())


def get_whoop_cache(target_date: date) -> dict | None:
    today_str = target_date.isoformat()
    result = (
        supabase.table("whoop_cache")
        .select("*")
        .eq("date", today_str)
        .execute()
    )
    if result.data:
        return result.data[0]
    return None


async def get_conversation_state(from_number: str) -> dict:
    """Get conversation state for a phone number. Default: free_chat."""
    try:
        result = (
            supabase.table("conversation_state")
            .select("*")
            .eq("phone", from_number)
            .execute()
        )
        if result.data:
            row = result.data[0]
            return {
                "flow": row.get("flow", "free_chat"),
                "step": row.get("step", 0),
                "context": row.get("context") or {},
            }
    except Exception as e:
        logger.warning(f"get_conversation_state failed (table may not exist): {e}")
    return {"flow": "free_chat", "step": 0, "context": {}}


async def update_conversation_state(
    from_number: str, flow: str, step: int, context: dict
):
    try:
        supabase.table("conversation_state").upsert(
            {
                "phone": from_number,
                "flow": flow,
                "step": step,
                "context": context,
                "updated_at": datetime.utcnow().isoformat(),
            },
            on_conflict="phone",
        ).execute()
    except Exception as e:
        logger.warning(f"conversation_state upsert failed (table may not exist): {e}")


async def get_food_log_totals(target_date: date) -> dict:
    """Get calorie and macro totals for a given date."""
    today_str = target_date.isoformat()
    result = (
        supabase.table("food_log")
        .select("calories, protein_g, carbs_g, fat_g")
        .eq("date", today_str)
        .execute()
    )
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
    result = (
        supabase.table("food_log")
        .select("description")
        .eq("date", today_str)
        .order("time", desc=True)
        .limit(limit)
        .execute()
    )
    return [r.get("description", "") for r in (result.data or []) if r.get("description")]


async def get_daily_plan(target_date: date) -> dict | None:
    """Get daily plan if table exists. Returns None if not configured."""
    try:
        result = (
            supabase.table("daily_plans")
            .select("*")
            .eq("date", target_date.isoformat())
            .execute()
        )
        if result.data:
            return result.data[0]
    except Exception:
        pass
    return None


def get_calorie_target(strain_score: float | None, settings: dict) -> int:
    return determine_calorie_target(strain_score, settings)


async def sync_whoop_today():
    """Sync today's Whoop data to cache."""
    token = await get_whoop_token()
    if not token:
        return

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

    today_str = date.today().isoformat()
    upsert_payload = {"date": today_str, "last_updated": now.isoformat()}
    for k, v in whoop_data.items():
        if v is not None:
            upsert_payload[k] = v

    supabase.table("whoop_cache").upsert(upsert_payload, on_conflict="date").execute()


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
    supabase.table("food_log").insert({
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
    supabase.table("conversation_log").insert({
        "direction": direction,
        "message": message,
    }).execute()


async def log_to_conversation(
    inbound: str, outbound: str, source: str = "text", flow: str = "free_chat"
):
    try:
        supabase.table("conversation_log").insert([
            {"direction": "inbound", "message": inbound, "flow": flow, "source": source},
            {"direction": "outbound", "message": outbound, "flow": flow, "source": "system"},
        ]).execute()
    except Exception as e:
        logger.warning(f"log_to_conversation with flow/source failed: {e}")
        log_conversation("inbound", inbound)
        log_conversation("outbound", outbound)


async def analyze_meal_image(
    image_base64: str, content_type: str, context: dict
) -> dict:
    """Core Claude vision function for food detection and nutrition estimation."""
    daily_plan_str = json.dumps(context.get("daily_plan")) if context.get("daily_plan") else "none"
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

RESPOND IN THIS EXACT JSON FORMAT — no other text, no markdown, no code blocks:
{
  "scene": {
    "context": "home/restaurant/fast_food/packaged",
    "plate_size_estimate": "10-inch dinner plate",
    "meal_completeness": "full meal/partial/snack"
  },
  "components": [
    {
      "food": "grilled chicken breast",
      "category": "protein",
      "portion_estimate": "140g cooked",
      "portion_reasoning": "palm-sized piece approximately 1 inch thick",
      "calories": 185,
      "protein_g": 35,
      "carbs_g": 0,
      "fat_g": 4,
      "fiber_g": 0,
      "sodium_mg": 65,
      "sugar_g": 0,
      "saturated_fat_g": 1,
      "confidence": "high"
    }
  ],
  "hidden_calories": [
    {
      "item": "olive oil cooking sheen visible on chicken",
      "estimated_amount": "1 tbsp",
      "calories_added": 120
    }
  ],
  "totals": {
    "calories": 650,
    "protein_g": 45,
    "carbs_g": 60,
    "fat_g": 18,
    "fiber_g": 8,
    "sodium_mg": 420,
    "sugar_g": 12,
    "saturated_fat_g": 5
  },
  "meal_type": "breakfast/lunch/dinner/snack",
  "overall_confidence": "high/medium/low",
  "confidence_notes": "sauce quantity uncertain, rice portion estimated from bowl depth",
  "uncertainty_items": ["sauce volume", "oil used in cooking"],
  "sports_nutrition_flags": {
    "protein_adequate": true,
    "post_workout_suitable": true,
    "micronutrient_alerts": ["sodium 420mg moderate"],
    "inflammatory_risk": "low"
  },
  "sms_confirmation": "Grilled chicken, rice, roasted veg + olive oil — ~650 kcal, 45g protein, 60g carbs. Leaves you 980 kcal today. Sauce qty uncertain so may be ±50 kcal. Look right? Reply YES to log or correct me.",
  "clarifying_question": null
}

If image quality is too poor or no food is visible return:
{
  "error": "cannot_analyze",
  "reason": "specific reason here",
  "sms_confirmation": "specific actionable message to user explaining the issue"
}"""

    response = claude_client.messages.create(
        model="claude-opus-4-6",
        max_tokens=2048,
        system=system_prompt,
        messages=[
            {
                "role": "user",
                "content": [
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
                        "text": f"{context_str}\n\nAnalyze this meal image following your protocol exactly. Return JSON only.",
                    },
                ],
            }
        ],
    )

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.replace("```", "").strip()

    result = json.loads(raw)

    if "error" in result:
        raise ValueError(result.get("sms_confirmation", "Could not analyze image."))

    if result.get("overall_confidence") == "medium":
        result["totals"]["calories"] = round(result["totals"]["calories"] * 1.10)
    elif result.get("overall_confidence") == "low":
        result["totals"]["calories"] = round(result["totals"]["calories"] * 1.15)

    return result


async def apply_meal_correction(correction: str, original_meal: dict) -> dict:
    """User corrected something about the meal estimate. Pass back to Claude to update."""
    response = claude_client.messages.create(
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


async def transcribe_audio(media_url: str, media_content_type: str) -> str:
    """Transcribe voice note via OpenAI Whisper. Requires OPENAI_API_KEY."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise NotImplementedError("Voice transcription requires OPENAI_API_KEY")

    async with httpx.AsyncClient() as client:
        auth = (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        resp = await client.get(media_url, auth=auth)
        resp.raise_for_status()
        audio_bytes = resp.content

    async with httpx.AsyncClient() as http_client:
        files = {"file": ("audio.ogg", audio_bytes, media_content_type)}
        data = {"model": "whisper-1"}
        headers = {"Authorization": f"Bearer {api_key}"}
        r = await http_client.post(
            "https://api.openai.com/v1/audio/transcriptions",
            files=files,
            data=data,
            headers=headers,
        )
        r.raise_for_status()
        return r.json().get("text", "").strip()


def send_sms(to: str, body: str):
    twilio_client.messages.create(
        body=body,
        from_=TWILIO_PHONE_NUMBER,
        to=to,
    )


async def get_whoop_token() -> str | None:
    result = supabase.table("whoop_tokens").select("*").eq("id", 1).execute()
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

        supabase.table("whoop_tokens").upsert({
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

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/auth/whoop")
async def auth_whoop():
    params = {
        "client_id": WHOOP_CLIENT_ID,
        "redirect_uri": WHOOP_REDIRECT_URI,
        "response_type": "code",
        "scope": WHOOP_SCOPES,
    }
    return RedirectResponse(url=f"{WHOOP_AUTH_URL}?{urlencode(params)}")


@app.get("/auth/whoop/callback")
async def auth_whoop_callback(code: str):
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
        resp.raise_for_status()
        data = resp.json()

    new_expires = datetime.now(timezone.utc).timestamp() + data["expires_in"]
    expires_at = datetime.fromtimestamp(new_expires, tz=timezone.utc).isoformat()

    supabase.table("whoop_tokens").upsert({
        "id": 1,
        "access_token": data["access_token"],
        "refresh_token": data["refresh_token"],
        "expires_at": expires_at,
    }).execute()

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

    supabase.table("whoop_cache").upsert(upsert_payload, on_conflict="date").execute()

    return {"status": "synced", "data": whoop_data}


async def handle_image_entry(image_data: dict, from_number: str):
    """Called when an image is received. Builds today's context, calls Claude vision, stores pending meal, sends confirmation SMS."""
    await sync_whoop_today()

    today = date.today()
    whoop = await get_whoop_cache(today)
    food_totals = await get_food_log_totals(today)
    daily_plan = await get_daily_plan(today)
    settings = get_settings()

    strain = whoop.get("strain_score", 0) if whoop else 0
    calorie_target = get_calorie_target(strain, settings)

    memory = get_mem0()
    food_memories = memory.search("preferred foods and typical meals", user_id=USER_ID)
    recent_meals = await get_recent_food_log_descriptions(today, limit=3)

    context = {
        "calorie_target": calorie_target,
        "eaten_calories": food_totals.get("calories", 0),
        "eaten_protein": food_totals.get("protein_g", 0),
        "remaining_calories": calorie_target - food_totals.get("calories", 0),
        "protein_target": settings.get("protein_goal_g", 160),
        "carb_target": settings.get("carb_goal_g", 220),
        "fat_target": settings.get("fat_goal_g", 70),
        "food_memories": [m["memory"] for m in food_memories] if food_memories else [],
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

    await update_conversation_state(
        from_number,
        flow="image_confirmation",
        step=1,
        context={"pending_meal": analysis, "from_number": from_number},
    )

    sms = analysis.get(
        "sms_confirmation",
        "I analyzed your meal. Does this look right? Reply YES to log or correct me.",
    )
    send_sms(to=from_number, body=sms)

    await log_to_conversation(
        inbound="[Image sent]",
        outbound=sms,
        source="image",
        flow="image_confirmation",
    )


async def handle_image_confirmation(
    from_number: str, user_message: str, state_context: dict
) -> str:
    """Handles the YES/correction loop after image analysis. Loops until user confirms, then logs to food_log and clears state."""
    pending_meal = state_context.get("pending_meal")
    if not pending_meal:
        await update_conversation_state(from_number, flow="free_chat", step=0, context={})
        return "Something went wrong. Please try sending the photo again."

    user_msg_lower = user_message.lower().strip()

    CONFIRM_PHRASES = [
        "yes", "yeah", "yep", "yup", "correct", "right",
        "looks good", "log it", "that's right", "perfect", "ok", "okay", "sure",
    ]

    if any(phrase in user_msg_lower for phrase in CONFIRM_PHRASES):
        totals = pending_meal["totals"]
        meal_type = pending_meal.get("meal_type", "meal")
        components = pending_meal.get("components", [])
        description = ", ".join([c["food"] for c in components]) if components else pending_meal.get("description", "")

        insert_row = {
            "date": str(date.today()),
            "time": datetime.now().strftime("%H:%M:%S"),
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
            supabase.table("food_log").insert(insert_row).execute()
        except Exception as e:
            logger.warning(f"food_log insert (some columns may not exist): {e}")
            supabase.table("food_log").insert({
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

        today_totals = await get_food_log_totals(date.today())
        settings = get_settings()
        whoop = await get_whoop_cache(date.today())
        strain = whoop.get("strain_score", 0) if whoop else 0
        calorie_target = get_calorie_target(strain, settings)
        remaining = calorie_target - today_totals.get("calories", 0)

        await update_conversation_state(from_number, flow="free_chat", step=0, context={})

        flags = pending_meal.get("sports_nutrition_flags", {})
        flag_note = ""
        if flags.get("micronutrient_alerts"):
            flag_note = f" Note: {flags['micronutrient_alerts'][0]}."

        return f"Logged ✓ {totals['calories']} kcal | {totals['protein_g']}g protein | {totals['carbs_g']}g carbs | {totals['fat_g']}g fat. {remaining} kcal remaining today.{flag_note}"

    else:
        try:
            corrected = await apply_meal_correction(user_message, pending_meal)
            await update_conversation_state(
                from_number,
                flow="image_confirmation",
                step=1,
                context={**state_context, "pending_meal": corrected},
            )
            return corrected.get("sms_confirmation", "Updated. Does this look right now? Reply YES to log.")
        except Exception as e:
            logger.error(f"apply_meal_correction failed: {e}")
            return "Had trouble updating that. Can you rephrase? e.g. 'bigger portion of rice' or 'no sauce'"


async def process_message(
    incoming_message: str,
    from_number: str,
    input_source: str = "text",
    transcription_note: str = None,
    image_data: dict = None,
):
    state = await get_conversation_state(from_number)
    flow = state.get("flow", "free_chat")
    step = state.get("step", 0)
    context = state.get("context", {})

    if incoming_message == "__IMAGE_MEAL__" and image_data:
        await handle_image_entry(image_data, from_number)
        return

    if flow == "image_confirmation":
        response_text = await handle_image_confirmation(from_number, incoming_message, context)
        send_sms(to=from_number, body=response_text)
        await log_to_conversation(
            incoming_message, response_text,
            source=input_source,
            flow="image_confirmation",
        )
        return

    settings = get_settings()
    food_rows, food_totals = get_today_food_log()
    whoop_data = get_today_whoop_cache()

    try:
        memory = get_mem0()
        memories_result = memory.search(query=incoming_message, user_id=USER_ID)
        memories = memories_result if isinstance(memories_result, list) else []
    except Exception as e:
        logger.error(f"Mem0 search failed: {e}")
        memories = []

    if transcription_note and input_source == "voice":
        incoming_message = f"[Voice note — interpret as meal description if food is mentioned]: {incoming_message}"

    system_prompt = build_system_prompt(settings, whoop_data, food_rows, food_totals, memories)
    response = claude_client.messages.create(
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
            user_id=USER_ID,
        )
    except Exception as e:
        logger.error(f"Mem0 add failed: {e}")


@app.post("/webhook/sms")
async def webhook_sms(request: Request, background_tasks: BackgroundTasks):
    form_data = await request.form()

    incoming_message = form_data.get("Body", "").strip()
    from_number = form_data.get("From", "")
    num_media = int(form_data.get("NumMedia", "0"))

    input_source = "text"
    transcription_note = None
    image_data = None

    if num_media > 0:
        media_content_type = form_data.get("MediaContentType0", "")
        media_url = form_data.get("MediaUrl0", "")

        if media_content_type.startswith("audio/"):
            try:
                incoming_message = await transcribe_audio(media_url, media_content_type)
                transcription_note = f"[Voice note transcribed: '{incoming_message}']"
                input_source = "voice"
            except Exception as e:
                send_sms(to=from_number, body="Couldn't transcribe that voice note. Try again or describe your meal in text.")
                return Response(content='<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>', media_type="text/xml")

        elif media_content_type.startswith("image/"):
            try:
                async with httpx.AsyncClient() as client:
                    img_response = await client.get(
                        media_url,
                        auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
                    )
                    img_response.raise_for_status()
                    image_bytes = img_response.content
                    image_base64 = base64.b64encode(image_bytes).decode("utf-8")

                image_data = {
                    "base64": image_base64,
                    "content_type": media_content_type,
                }
                incoming_message = "__IMAGE_MEAL__"
                input_source = "image"

            except Exception as e:
                logger.error(f"Image download failed: {e}")
                send_sms(to=from_number, body="Couldn't process that photo. Try again or describe your meal in text.")
                return Response(content='<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>', media_type="text/xml")

        else:
            send_sms(to=from_number, body="I can only process voice notes, photos, and text right now.")
            return Response(content='<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>', media_type="text/xml")

    if not incoming_message:
        return Response(content='<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>', media_type="text/xml")

    background_tasks.add_task(
        process_message,
        incoming_message,
        from_number,
        input_source,
        transcription_note,
        image_data,
    )
    return Response(content='<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>', media_type="text/xml")


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

    response = claude_client.messages.create(
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

    response = claude_client.messages.create(
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
