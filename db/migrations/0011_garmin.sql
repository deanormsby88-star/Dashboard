-- Garmin Connect (unofficial login) connection, one per user. The Garmin
-- password is stored AES-256-GCM encrypted (see src/lib/crypto.ts).
create table if not exists garmin_connections (
  user_id       uuid primary key references users(id) on delete cascade,
  username      text not null,
  password_enc  text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table garmin_connections enable row level security;
