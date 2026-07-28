-- ============================================================================
-- DeanOS GO-LIVE migration — paste this whole file into the Supabase SQL Editor
-- and press Run. Safe to run more than once (every statement is idempotent).
--
-- This brings your EXISTING database up to the multi-user schema:
--   • adds identity + onboarding columns to users
--   • marks existing users as already set up (so you skip the wizard)
--   • relaxes the old hard-coded context checks (heya/jic/personal)
--   • adds per-user Telegram linking
--
-- It does NOT delete or rewrite any of your data.
-- ============================================================================

-- ── 0008: multi-user identity + onboarding ─────────────────────────────────
alter table users add column if not exists microsoft_oid     text;
alter table users add column if not exists last_login_at      timestamptz;
alter table users add column if not exists setup_completed_at timestamptz;

update users set setup_completed_at = now() where setup_completed_at is null;

create unique index if not exists users_microsoft_oid_key
  on users (microsoft_oid) where microsoft_oid is not null;

alter table businesses drop constraint if exists businesses_key_check;
alter table calendar_connections drop constraint if exists calendar_connections_calendar_check;

-- ── 0009: per-user Telegram ─────────────────────────────────────────────────
alter table users add column if not exists telegram_chat_id text;

create unique index if not exists users_telegram_chat_id_key
  on users (telegram_chat_id) where telegram_chat_id is not null;

-- ── Record them as applied so `npm run migrate` won't re-run them ───────────
insert into schema_migrations (filename) values
  ('0008_multi_user.sql'),
  ('0009_telegram_per_user.sql')
on conflict (filename) do nothing;
