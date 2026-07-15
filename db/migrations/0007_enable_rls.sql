-- Security hardening: enable Row-Level Security on every public table.
--
-- DeanOS connects to Postgres over a direct, owner-role connection, which
-- BYPASSES RLS — so the app is unaffected. This only closes off Supabase's
-- public REST API (PostgREST): with RLS enabled and no policies, the anon /
-- authenticated roles are denied all access. Resolves the Supabase advisor
-- warning `rls_disabled_in_public`.
--
-- Idempotent: enabling RLS on a table that already has it is a no-op.

do $$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security;', r.tablename);
  end loop;
end $$;
