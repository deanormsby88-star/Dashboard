-- Phase: Today dashboard + daily brief.
-- Stores each generated executive brief so the morning brief (produced by a
-- scheduled job) is waiting on the Today page and doesn't require an OpenAI
-- call on every page view.

create table briefs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  generated_for  date not null,
  content        text not null default '',
  top3           jsonb not null default '[]'::jsonb,
  ignore_today   jsonb not null default '[]'::jsonb,
  chase          jsonb not null default '[]'::jsonb,
  recommendation text,
  source         text not null default 'manual' check (source in ('manual', 'cron')),
  created_at     timestamptz not null default now()
);
create index briefs_user_created_idx on briefs (user_id, created_at desc);
