-- Phase 3: calendar. Read-only event mirror pulled from per-calendar ICS feeds.

create table calendar_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  business_id  uuid references businesses(id) on delete set null,
  calendar     text not null check (calendar in ('heya', 'jic', 'personal')),
  source_uid   text not null,
  title        text not null default '',
  location     text,
  description  text,
  organizer    text,
  attendees    text[] not null default '{}',
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  all_day      boolean not null default false,
  url          text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- one row per occurrence: recurring instances share source_uid, differ by start.
  unique (user_id, calendar, source_uid, starts_at)
);
create index calendar_events_user_start_idx on calendar_events (user_id, starts_at);
