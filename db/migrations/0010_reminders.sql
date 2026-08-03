-- Apple Reminders (iCloud CalDAV) connection, one per user. The app-specific
-- password is stored AES-256-GCM encrypted (see src/lib/crypto.ts), never in
-- plaintext. list_url/list_name is the single Reminders list DeanOS reads/writes.
create table if not exists reminder_connections (
  user_id           uuid primary key references users(id) on delete cascade,
  provider          text not null default 'apple',
  username          text not null,
  app_password_enc  text not null,
  list_url          text,
  list_name         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table reminder_connections enable row level security;
