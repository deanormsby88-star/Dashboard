-- DeanOS one-shot database setup for the Supabase SQL Editor (fresh installs).
-- Paste this entire file into Supabase → SQL Editor → Run.

create table if not exists schema_migrations (
  filename   text primary key,
  applied_at timestamptz not null default now()
);

-- DeanOS initial schema (Phase 1)
-- Every domain table is scoped to a user_id even though the MVP is
-- single-user, so multi-tenancy is never a retrofit.

create extension if not exists pgcrypto;

-- ── Users ────────────────────────────────────────────────────────────────────
create table users (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  name        text,
  created_at  timestamptz not null default now()
);

-- ── Businesses (Heya / JIC / Personal) ───────────────────────────────────────
create table businesses (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  key                 text not null check (key in ('heya', 'jic', 'personal')),
  name                text not null,
  todoist_project_id  text,
  created_at          timestamptz not null default now(),
  unique (user_id, key)
);

-- ── People ───────────────────────────────────────────────────────────────────
create table people (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  business_id   uuid references businesses(id) on delete set null,
  full_name     text not null,
  role          text,
  organization  text,
  email         text,
  phone         text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index people_user_name_idx on people (user_id, lower(full_name));

-- ── Meetings ─────────────────────────────────────────────────────────────────
create table meetings (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  business_id        uuid references businesses(id) on delete set null,
  source_system      text not null default 'circleback',
  source_record_id   text not null,
  source_url         text,
  title              text not null,
  meeting_date       timestamptz,
  notes              text not null default '',
  transcript         text not null default '',
  summary            text,
  recommended_follow_up text,
  processing_status  text not null default 'pending'
                     check (processing_status in ('pending', 'processing', 'processed', 'failed')),
  processing_error   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, source_system, source_record_id)
);
create index meetings_user_date_idx on meetings (user_id, meeting_date desc);

create table meeting_attendees (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references meetings(id) on delete cascade,
  person_id   uuid references people(id) on delete set null,
  name        text,
  email       text
);
create index meeting_attendees_meeting_idx on meeting_attendees (meeting_id);

-- ── Tasks ────────────────────────────────────────────────────────────────────
-- DeanOS task records mirror what will exist in Todoist. Todoist remains the
-- system of record for execution; these rows track provenance and review state.
create table tasks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  business_id       uuid references businesses(id) on delete set null,
  meeting_id        uuid references meetings(id) on delete set null,
  title             text not null,
  description       text not null default '',
  priority          int not null default 2 check (priority between 1 and 4),
  due_date          date,
  labels            text[] not null default '{}',
  origin            text not null default 'action_item'
                    check (origin in ('action_item', 'commitment', 'both', 'waiting_on', 'manual')),
  status            text not null default 'suggested'
                    check (status in ('suggested', 'approved', 'rejected', 'sent', 'created', 'completed', 'failed')),
  status_error      text,
  confidence        real,
  todoist_task_id   text,
  todoist_task_url  text,
  source_system     text,
  source_record_id  text,
  source_url        text,
  dedup_key         text not null,
  ai_run_id         uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, dedup_key)
);
create index tasks_user_status_idx on tasks (user_id, status);
create index tasks_meeting_idx on tasks (meeting_id);

-- ── Commitments (by_dean = Dean promised; to_dean = Dean is waiting on them) ─
create table commitments (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  business_id       uuid references businesses(id) on delete set null,
  meeting_id        uuid references meetings(id) on delete set null,
  direction         text not null check (direction in ('by_dean', 'to_dean')),
  text              text not null,
  person_id         uuid references people(id) on delete set null,
  person_name       text,
  company           text,
  date_made         date,
  due_date          date,
  status            text not null default 'open'
                    check (status in ('open', 'done', 'cancelled')),
  confidence        real,
  linked_task_id    uuid references tasks(id) on delete set null,
  source_system     text,
  source_record_id  text,
  source_url        text,
  dedup_key         text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, dedup_key)
);
create index commitments_user_direction_idx on commitments (user_id, direction, status);

-- ── Risks ────────────────────────────────────────────────────────────────────
create table risks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  business_id       uuid references businesses(id) on delete set null,
  meeting_id        uuid references meetings(id) on delete set null,
  description       text not null,
  severity          text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  status            text not null default 'open' check (status in ('open', 'mitigated', 'closed')),
  confidence        real,
  source_system     text,
  source_record_id  text,
  source_url        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index risks_user_status_idx on risks (user_id, status);

-- ── Decisions ────────────────────────────────────────────────────────────────
create table decisions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  business_id       uuid references businesses(id) on delete set null,
  meeting_id        uuid references meetings(id) on delete set null,
  text              text not null,
  decided_on        date,
  confidence        real,
  source_system     text,
  source_record_id  text,
  source_url        text,
  created_at        timestamptz not null default now()
);
create index decisions_user_idx on decisions (user_id, created_at desc);

-- ── Interactions (communication history / relationship updates) ─────────────
create table interactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  person_id         uuid references people(id) on delete set null,
  person_name       text,
  meeting_id        uuid references meetings(id) on delete set null,
  kind              text not null default 'relationship_update'
                    check (kind in ('relationship_update', 'meeting', 'email', 'note')),
  summary           text not null,
  occurred_at       timestamptz not null default now(),
  confidence        real,
  source_system     text,
  source_record_id  text,
  source_url        text,
  created_at        timestamptz not null default now()
);
create index interactions_user_person_idx on interactions (user_id, person_id);

-- ── Source records (raw payloads, verbatim, for provenance and replay) ──────
create table source_records (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  source_system     text not null,
  source_record_id  text not null,
  payload           jsonb not null,
  received_at       timestamptz not null default now(),
  unique (user_id, source_system, source_record_id)
);

-- ── Sync runs ────────────────────────────────────────────────────────────────
create table sync_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  source_system  text not null,
  status         text not null default 'running'
                 check (status in ('running', 'succeeded', 'failed')),
  stats          jsonb not null default '{}'::jsonb,
  error          text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index sync_runs_user_source_idx on sync_runs (user_id, source_system, started_at desc);

-- ── Webhook events (every inbound request, incl. invalid ones — never drop) ─
create table webhook_events (
  id               uuid primary key default gen_random_uuid(),
  endpoint         text not null,
  idempotency_key  text not null unique,
  payload          jsonb,
  raw_body         text,
  status           text not null default 'received'
                   check (status in ('received', 'processed', 'duplicate', 'failed')),
  error            text,
  received_at      timestamptz not null default now(),
  processed_at     timestamptz
);
create index webhook_events_endpoint_idx on webhook_events (endpoint, received_at desc);

-- ── AI runs (every model call: inputs, raw output, parse status) ────────────
create table ai_runs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references users(id) on delete cascade,
  prompt_name     text not null,
  prompt_version  text not null,
  model           text not null,
  input           jsonb,
  raw_output      text,
  parsed_output   jsonb,
  status          text not null default 'ok'
                  check (status in ('ok', 'parse_failed', 'api_failed')),
  error           text,
  usage           jsonb,
  created_at      timestamptz not null default now()
);
create index ai_runs_prompt_idx on ai_runs (prompt_name, created_at desc);

-- Phase 2: email ingestion.
-- Emails are events, not an archive: bodies are stored truncated (the mail
-- platform remains the system of record — see SECURITY.md).

create table emails (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  business_id        uuid references businesses(id) on delete set null,
  mailbox            text not null check (mailbox in ('heya', 'jic', 'personal')),
  direction          text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  sender             text not null default '',
  recipients         text[] not null default '{}',
  subject            text not null default '',
  body_text          text not null default '',
  email_date         timestamptz,
  thread_id          text,
  message_id         text not null,
  source_url         text,
  flags              text[] not null default '{}',
  attachments        jsonb,
  classification     text check (classification in
                       ('ignore', 'action', 'waiting_on', 'risk', 'reference', 'relationship_update')),
  confidence         real,
  summary            text,
  suggested_task_id  uuid references tasks(id) on delete set null,
  processing_status  text not null default 'pending'
                     check (processing_status in ('pending', 'processing', 'processed', 'failed')),
  processing_error   text,
  resolved           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, message_id)
);
create index emails_user_unresolved_idx on emails (user_id, resolved, created_at desc);
create index emails_thread_idx on emails (user_id, thread_id);

insert into schema_migrations (filename) values ('0001_init.sql'), ('0002_emails.sql')
on conflict (filename) do nothing;
