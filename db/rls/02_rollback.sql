-- ============================================================================
-- DeanOS — ROLL BACK DB-enforced RLS (undo db/rls/01_enable_enforcement.sql)
-- ============================================================================
--
-- Use this if enforcement causes problems and you need to fall back to
-- app-level isolation only. It removes the per-user policies but LEAVES RLS
-- enabled with no policies — i.e. it returns each table to the migration-0007
-- state (PostgREST still denied; owner connection still bypasses).
--
-- Before running: point DATABASE_URL back at the OWNER role, otherwise the
-- app (connecting as deanos_app) will see zero rows once policies are dropped.
--
-- Idempotent.
-- ============================================================================

begin;

do $$
declare
  t text;
  all_tables text[] := array[
    'businesses','people','meetings','tasks','commitments','risks',
    'decisions','interactions','source_records','sync_runs','ai_runs',
    'emails','briefs','conversation_messages','calendar_events',
    'calendar_connections','meeting_attendees','users','webhook_events'
  ];
begin
  foreach t in array all_tables loop
    execute format('drop policy if exists user_isolation on public.%I;', t);
    execute format('drop policy if exists self_row on public.%I;', t);
    execute format('drop policy if exists system_only on public.%I;', t);
    -- Keep RLS ENABLED (0007) but drop FORCE so the owner connection is unaffected.
    execute format('alter table public.%I no force row level security;', t);
  end loop;
end $$;

commit;

-- To fully remove the app role and helpers as well (optional, after DATABASE_URL
-- is back on the owner role and no session uses deanos_app):
--   revoke all on all tables in schema public from deanos_app;
--   revoke all on all sequences in schema public from deanos_app;
--   revoke all on schema public, app from deanos_app;
--   drop role deanos_app;
--   drop schema app cascade;
