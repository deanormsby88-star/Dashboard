# DB-enforced isolation (RLS backstop)

This folder holds a **prepared, not-yet-activated** Row-Level Security layer. It
is the "defence-in-depth" backstop: a second, database-level guarantee that one
user can never read another user's rows, sitting underneath the app-level
isolation that is already live.

> **TL;DR for launch:** You do **not** need this turned on to go live safely.
> App-level isolation (every query filters by `user_id`, enforced by
> `tests/isolation-guard.test.ts`) is the active protection today, and
> migration `0007` already closed the only externally-reachable surface
> (Supabase's public REST API). This RLS layer is a hardening step to apply
> **after** launch, tested on a preview database first. Turning it on is an
> infra change, not a code deploy.

## Why it's staged (and not a normal migration)

DeanOS connects to Postgres as the **table owner**, and Postgres owners
**bypass RLS**. So even though migration `0007` enabled RLS everywhere, it has
zero effect on the app's own connection — by design, it only locks out
Supabase's anon/authenticated PostgREST roles.

Making RLS a real backstop needs two changes done **together**:

1. **Database** — a non-owner role `deanos_app`, per-user policies, and
   `FORCE ROW LEVEL SECURITY`. → `01_enable_enforcement.sql`
2. **App** — connect as `deanos_app` instead of the owner, and stamp the
   current user onto every transaction. → see "App change" below.

Doing (1) without (2) makes the app see **zero rows**. That's why these files
live outside `db/migrations/` (which auto-applies on deploy) and behind this
runbook.

## How the policies work

Every request carries its user in two transaction-local settings:

| setting          | meaning                                                        |
| ---------------- | -------------------------------------------------------------- |
| `app.user_id`    | the signed-in user's UUID — policies compare `user_id` to this |
| `app.bypass_rls` | `'on'` only for trusted **system** contexts (see below)        |

Policies read them via `app.current_user_id()` and `app.is_system()`. An
un-contexted connection (`app.user_id` unset, bypass off) sees nothing — fail
closed.

**System contexts** that legitimately act outside one user (must set
`app.bypass_rls = 'on'`):

- Login / user provisioning (`ensureUser`, `getUserByEmail`) — runs before a
  session/user exists.
- Inbound webhooks writing to `webhook_events`.
- Cron fan-out (`forEachUser`) — set `app.user_id` per user inside the loop
  instead, so each user's work stays isolated; use bypass only for the
  `listAllUsers` lookup.

## App change required to activate (the second half)

The app must set the context at the start of every DB transaction. Recommended
shape (add when activating, wire through `src/lib/db`):

```ts
// pseudocode — run each unit of work on a dedicated client inside a txn
const client = await pool.connect();
try {
  await client.query("begin");
  if (systemContext) {
    await client.query("select set_config('app.bypass_rls', 'on', true)");
  } else {
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
  }
  // ... the actual repo queries on `client` ...
  await client.query("commit");
} finally {
  client.release();
}
```

Because DeanOS currently issues queries via `getPool().query(...)` in ~90
places, the cleanest activation is to thread the request's `userId` (already
available from `getSessionUser()` / the cron `forEachUser` loop) into a
per-request client wrapper rather than editing every call site. Do this on a
branch and prove it against a preview DB before it ever touches production.

## Activation runbook (do this on a PREVIEW/staging DB first)

1. **Branch a copy of the database** (Supabase: create a preview branch, or a
   throwaway project restored from backup). Never rehearse on production.
2. Apply `01_enable_enforcement.sql` to that DB (as the owner/superuser).
3. Create a password for the new role and build a second connection string:
   ```sql
   alter role deanos_app login password '<generated-strong-password>';
   ```
   `DEANOS_APP_DATABASE_URL=postgres://deanos_app:<pw>@host:6543/postgres`
4. Deploy the app change above to a **preview** deployment pointed at that DB
   via the `deanos_app` URL.
5. **Verify isolation** with two real accounts: sign in as user A and user B;
   confirm each sees only their own tasks/emails/meetings; confirm login,
   webhooks, and the daily-brief cron still work (system contexts).
6. Run the in-file sanity block at the bottom of `01_enable_enforcement.sql`.
7. Only once green end-to-end: schedule the production cutover — apply the SQL,
   set the production `DATABASE_URL` to the `deanos_app` role, deploy.

## Rollback

If anything misbehaves: point `DATABASE_URL` back at the owner role and run
`02_rollback.sql`. That drops the policies and `FORCE`, returning every table to
the safe migration-`0007` state (PostgREST still denied, owner bypasses). The
app keeps working on app-level isolation exactly as before.
