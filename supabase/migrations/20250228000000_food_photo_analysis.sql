-- Food photo analysis: conversation state, log metadata, and food_log enhancements

-- conversation_state: tracks flow (free_chat, image_confirmation) per phone number
create table if not exists conversation_state (
  phone text primary key,
  flow text not null default 'free_chat',
  step int not null default 0,
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
