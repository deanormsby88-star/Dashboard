-- ============================================================================
-- DeanOS — DB-ENFORCED per-user isolation (Row-Level Security backstop)
-- ============================================================================
--
-- WHAT THIS IS
--   Defence-in-depth. The application already isolates users in code (every
--   query filters by user_id, enforced by tests/isolation-guard.test.ts).
--   This script makes the DATABASE itself refuse to return another user's
--   rows, even if an application bug or SQL injection slipped past that layer.
--
-- WHY IT IS NOT A MIGRATION
--   Migration 0007 already enabled RLS on every table with NO policies — that
--   closed off Supabase's public REST API (PostgREST anon/authenticated roles).
--   But DeanOS connects as the table OWNER, which BYPASSES RLS entirely, so
--   0007 does nothing to the app's own connection.
--
--   Turning RLS into a real backstop requires TWO things that must be done
--   deliberately by an operator, together, and tested on a preview database
--   first — never applied blind to production:
--
--     1. This SQL: a non-owner role `deanos_app`, per-user policies, and
--        FORCE ROW LEVEL SECURITY so the policies bind even for a table owner.
--     2. An app change: point DATABASE_URL at `deanos_app` (NOT the owner),
--        and set the request's user on every transaction via
--            select set_config('app.user_id', $userId, true);
--        (or `app.bypass_rls = 'on'` for system contexts — login, webhooks,
--        cron fan-out, user provisioning). See db/rls/README.md.
--
--   Applying (1) WITHOUT (2) breaks the app: the owner connection would keep
--   working (FORCE binds it too, and no user context is set → zero rows).
--   That is why this lives outside db/migrations/ and is gated behind the
--   runbook.
--
-- IDEMPOTENT: safe to re-run. Uses IF NOT EXISTS / CREATE OR REPLACE and
-- drops+recreates each policy.
-- ============================================================================

begin;

-- ── Request-context helpers ────────────────────────────────────────────────
-- All per-user state travels in two custom GUCs set per transaction by the app:
--   app.user_id     the current user's UUID (text)
--   app.bypass_rls  'on' for trusted system contexts, unset/anything else = off
-- current_setting(..., true) returns NULL (not an error) when the GUC is unset,
-- so an un-contexted connection simply sees nothing.

create schema if not exists app;

create or replace function app.current_user_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create or replace function app.is_system() returns boolean
  language sql stable
  as $$ select coalesce(current_setting('app.bypass_rls', true), 'off') = 'on' $$;

-- ── Application role (non-owner, no BYPASSRLS) ─────────────────────────────
-- DeanOS will connect as this role. Because it does not own the tables and is
-- not a superuser, RLS policies apply to it. FORCE (below) is belt-and-braces.
--
-- NOTE: set a password out-of-band, do not hard-code one here. On Supabase:
--   alter role deanos_app with password '<generated>';
-- then build DATABASE_URL from it. `nologin` here is flipped to login by the
-- password step; adjust to your platform's role-management story.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'deanos_app') then
    create role deanos_app nologin noinherit;
  end if;
end $$;

grant usage on schema public to deanos_app;
grant usage on schema app to deanos_app;
grant execute on function app.current_user_id() to deanos_app;
grant execute on function app.is_system() to deanos_app;

grant select, insert, update, delete on all tables in schema public to deanos_app;
grant usage, select on all sequences in schema public to deanos_app;

-- Future tables/sequences inherit the same grants automatically.
alter default privileges in schema public
  grant select, insert, update, delete on tables to deanos_app;
alter default privileges in schema public
  grant usage, select on sequences to deanos_app;

-- ── Policies ────────────────────────────────────────────────────────────────
-- Helper: a table whose own column holds user_id.
-- Pattern applied per table below (explicit, so it is auditable at a glance).

-- user-scoped tables keyed directly on user_id
do $$
declare
  t text;
  user_tables text[] := array[
    'businesses','people','meetings','tasks','commitments','risks',
    'decisions','interactions','source_records','sync_runs','ai_runs',
    'emails','briefs','conversation_messages','calendar_events',
    'calendar_connections'
  ];
begin
  foreach t in array user_tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);
    execute format('drop policy if exists user_isolation on public.%I;', t);
    execute format($f$
      create policy user_isolation on public.%I
        using (app.is_system() or user_id = app.current_user_id())
        with check (app.is_system() or user_id = app.current_user_id());
    $f$, t);
  end loop;
end $$;

-- meeting_attendees: no user_id of its own — isolate via its parent meeting.
alter table public.meeting_attendees enable row level security;
alter table public.meeting_attendees force row level security;
drop policy if exists user_isolation on public.meeting_attendees;
create policy user_isolation on public.meeting_attendees
  using (
    app.is_system() or exists (
      select 1 from public.meetings m
      where m.id = meeting_attendees.meeting_id
        and m.user_id = app.current_user_id()
    )
  )
  with check (
    app.is_system() or exists (
      select 1 from public.meetings m
      where m.id = meeting_attendees.meeting_id
        and m.user_id = app.current_user_id()
    )
  );

-- users: a signed-in user may see/update only their own row. Provisioning and
-- login (finding a user before a session exists) run under app.bypass_rls.
alter table public.users enable row level security;
alter table public.users force row level security;
drop policy if exists self_row on public.users;
create policy self_row on public.users
  using (app.is_system() or id = app.current_user_id())
  with check (app.is_system() or id = app.current_user_id());

-- webhook_events: system-only. No user_id; only trusted contexts touch it.
alter table public.webhook_events enable row level security;
alter table public.webhook_events force row level security;
drop policy if exists system_only on public.webhook_events;
create policy system_only on public.webhook_events
  using (app.is_system())
  with check (app.is_system());

-- schema_migrations is managed by the migration runner (owner connection) and
-- is intentionally left without a deanos_app policy — the app never reads it.

commit;

-- ── Post-apply sanity (run manually, do not leave uncommented) ──────────────
-- set role deanos_app;
-- select set_config('app.user_id', '<some-user-uuid>', false);
-- select count(*) from tasks;            -- only that user's tasks
-- select set_config('app.user_id', '<other-user-uuid>', false);
-- select count(*) from tasks;            -- only the other user's tasks
-- reset role;
