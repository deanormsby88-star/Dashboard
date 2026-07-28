-- Phase: multi-user. Turn the single-owner app into a multi-tenant one.
--
-- The data model is already per-user (every table has user_id), so this only
-- (a) adds identity/onboarding columns to users, and (b) relaxes the two CHECK
-- constraints that hard-coded Dean's three contexts (heya/jic/personal) so each
-- user can define their own work contexts.

-- Identity + onboarding state on the users table.
alter table users add column if not exists microsoft_oid    text;
alter table users add column if not exists last_login_at     timestamptz;
alter table users add column if not exists setup_completed_at timestamptz;

-- Existing users (the original owner) are already set up — don't force them
-- through the first-run wizard. New users created after this get NULL → wizard.
update users set setup_completed_at = now() where setup_completed_at is null;

-- Stable Microsoft object id is unique when present (nulls allowed for the
-- legacy env-seeded owner until first Microsoft sign-in).
create unique index if not exists users_microsoft_oid_key
  on users (microsoft_oid) where microsoft_oid is not null;

-- Contexts are now user-defined, not a fixed enum. Drop the CHECK that limited
-- businesses.key to heya/jic/personal. (Constraint name is Postgres's default
-- for a column check: <table>_<column>_check.)
alter table businesses drop constraint if exists businesses_key_check;

-- Same for calendar connections: a user connects their own calendar(s); the
-- key just needs to match one of their context keys, not a fixed set.
alter table calendar_connections drop constraint if exists calendar_connections_calendar_check;
