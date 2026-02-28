-- Daily intentions and plans
create table if not exists daily_plans (
  id uuid default gen_random_uuid() primary key,
  date date unique not null,
  recovery_score int,
  hrv_rmssd numeric,
  resting_heart_rate numeric,
  sleep_performance_pct numeric,
  suggested_effort_level text,
  confirmed_effort_level text,
  training_type text,
  training_time text,
  training_planned boolean default false,
  calorie_target int,
  protein_target_g int,
  carb_target_g int,
  fat_target_g int,
  meal_plan jsonb,
  plan_confirmed boolean default false,
  created_at timestamptz default now()
);

-- Conversation state machine
create table if not exists conversation_state (
  id int primary key default 1,
  flow text,
  step int default 0,
  context jsonb,
  last_updated timestamptz default now()
);

-- Enhanced food log
create table if not exists food_log (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  date date default current_date,
  time time default current_time,
  meal_type text,
  description text,
  calories int,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  fiber_g numeric,
  sodium_mg numeric,
  sugar_g numeric,
  source text
);

-- Whoop cache (upsert by date)
create table if not exists whoop_cache (
  id uuid default gen_random_uuid() primary key,
  date date unique not null,
  calories_burned_kcal numeric,
  strain_score numeric,
  recovery_score numeric,
  sleep_performance_pct numeric,
  sleep_hours numeric,
  hrv_rmssd numeric,
  resting_heart_rate numeric,
  workout_type text,
  workout_strain numeric,
  workout_kcal numeric,
  last_updated timestamptz default now()
);

-- Settings key/value
create table if not exists settings (
  key text primary key,
  value text
);

-- Conversation log
create table if not exists conversation_log (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  direction text,
  message text,
  flow text,
  source text
);

-- Whoop OAuth tokens
create table if not exists whoop_tokens (
  id int primary key default 1,
  access_token text,
  refresh_token text,
  expires_at timestamptz
);

-- Add columns to existing tables (safe to run on fresh or existing databases)
ALTER TABLE conversation_log ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE conversation_log ADD COLUMN IF NOT EXISTS flow text;
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS meal_type text;
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS fiber_g numeric;
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS sodium_mg numeric;
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS sugar_g numeric;
ALTER TABLE whoop_cache ADD COLUMN IF NOT EXISTS workout_type text;
ALTER TABLE whoop_cache ADD COLUMN IF NOT EXISTS workout_strain numeric;
ALTER TABLE whoop_cache ADD COLUMN IF NOT EXISTS workout_kcal numeric;

-- Weekly and monthly pattern summaries
create table if not exists pattern_summaries (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  period_type text,
  period_start date,
  period_end date,
  summary jsonb
);
