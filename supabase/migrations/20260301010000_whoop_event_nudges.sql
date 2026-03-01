create table if not exists whoop_event_nudges (
  id uuid default gen_random_uuid() primary key,
  event_type text not null,
  date date not null,
  last_sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(event_type, date)
);
