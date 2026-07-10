-- Apply migration 0002 (emails) to an existing DeanOS database.
-- Paste into Supabase → SQL Editor → Run.

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

insert into schema_migrations (filename) values ('0002_emails.sql')
on conflict (filename) do nothing;
