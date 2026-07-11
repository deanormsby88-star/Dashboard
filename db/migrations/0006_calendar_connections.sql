-- Phase 3: Microsoft Graph calendar connections (OAuth tokens, encrypted).
-- One connection per calendar (Heya / JIC Outlook). Tokens are stored
-- AES-256-GCM encrypted (see src/lib/crypto.ts).

create table calendar_connections (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  calendar           text not null check (calendar in ('heya', 'jic', 'personal')),
  provider           text not null default 'microsoft',
  account_email      text,
  access_token_enc   text not null,
  refresh_token_enc  text not null,
  expires_at         timestamptz not null,
  scope              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, calendar)
);
