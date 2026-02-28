-- Food photo analysis: per-phone image confirmation state (separate from main conversation_state)

-- image_confirmation_state: tracks image confirmation flow per phone number
-- (main conversation_state uses id=1 for morning planning etc.; this table is for MMS image flow)
create table if not exists image_confirmation_state (
  phone text primary key,
  flow text not null default 'image_confirmation',
  step int not null default 1,
  context jsonb default '{}',
  updated_at timestamptz default now()
);

-- conversation_log: add source and flow columns
alter table conversation_log add column if not exists source text default 'text';
alter table conversation_log add column if not exists flow text default 'free_chat';

-- food_log: add columns for image-based logging
alter table food_log add column if not exists meal_type text;
alter table food_log add column if not exists fiber_g numeric;
alter table food_log add column if not exists sodium_mg numeric;
alter table food_log add column if not exists sugar_g numeric;
