# Go-live: opening DeanOS to the organisation

This is the checklist to take DeanOS from "Dean's personal assistant" to "anyone
in the org signs in with Microsoft and gets their own private assistant." The
multi-user work lives on branch `claude/new-session-1c720n` and is deliberately
kept off `main` until the steps below pass on a preview deploy.

## 0. What changed (plain English)

- Sign-in is now **"Sign in with Microsoft"** — no passwords. The same consent
  connects each person's Outlook calendar + email.
- Sign-up is **domain-locked**: only work-email domains you list can join.
- Each person gets a **first-run wizard** (contexts, Telegram, done) and a fully
  **isolated** space — nobody sees anyone else's data.
- Background jobs (briefs, reminders, Teams, email triage) now run **per user**.

## 1. Pre-flight (no production impact)

- [x] `npx tsc --noEmit` clean
- [x] `npx vitest run` green (159 tests, incl. `isolation-guard`)
- [x] `npm run build` green
- [ ] Azure app registration is **multi-tenant** and the redirect URI matches
      `${APP_URL}/api/auth/microsoft/callback`. Teams messaging needs tenant
      admin consent.

## 2. Apply the two new migrations

Order matters; they are additive and safe (every table already has `user_id`).

```
DATABASE_URL=<prod> npm run migrate
```

This applies `0008_multi_user.sql` (adds `microsoft_oid`, `last_login_at`,
`setup_completed_at`; drops the `businesses.key` / `calendar_connections.calendar`
CHECKs; backfills `setup_completed_at` for existing users so Dean isn't forced
through the wizard) and `0009_telegram_per_user.sql` (adds `telegram_chat_id`).

## 3. Set the sign-up domain allow-list

In Vercel env (Production):

```
ALLOWED_SIGNUP_DOMAINS=heya.team,justimagineconsulting.co.za
```

**Fail-closed:** if this is empty, nobody new can sign in. Existing users
(Dean) are always allowed. Set this only when you're ready for colleagues.

## 4. Test on a PREVIEW deploy first (the real gate)

Deploy the branch as a Vercel preview with its own env, then:

1. **Dean regression** — sign in with Dean's Microsoft account. Confirm he
   lands on Today (not the wizard) and sees all his existing data. (His env-user
   row is matched by email on first Microsoft sign-in.)
2. **Second account** — sign in with a different `@heya.team` Microsoft account.
   Confirm: domain check passes → wizard → create contexts → Today. Then confirm
   this user sees **none** of Dean's tasks/emails/meetings, and Dean sees none of
   theirs.
3. **Disallowed domain** — try a `@gmail.com` (or any non-listed) account.
   Confirm it's rejected with a clear message.
4. **Telegram** — from Settings, "Connect Telegram", tap Start; confirm the
   daily brief and replies route to the right person.
5. **Background jobs** — trigger a cron (or wait) and confirm briefs/reminders
   are delivered per user, not merged.

## 5. Ship to production

- [ ] Merge `claude/new-session-1c720n` → `main`.
- [ ] Confirm production env has: `ALLOWED_SIGNUP_DOMAINS`, `SESSION_SECRET`,
      `CRON_SECRET`, Microsoft app creds, `APP_URL`.
- [ ] Smoke-test: Dean signs in on production; one colleague signs in and
      completes the wizard.

## 6. After launch — optional hardening

- **DB-enforced RLS backstop** (`db/rls/`): a second, database-level isolation
  guarantee beneath the app-level one. Prepared but intentionally not active —
  activating it is an infra change (non-owner DB role + per-request user
  context) that must be rehearsed on a preview DB. See `db/rls/README.md`. Not
  required for launch; app-level isolation + the isolation-guard test are the
  active protection, and migration `0007` already closed the public REST API.
- **Per-user Todoist tokens** — today task execution still uses one shared
  Todoist token. Roadmap: encrypted per-user tokens (mirror
  `calendar_connections`).
- **Admin view** — invite/disable users, per-user OpenAI cost visibility.

## Rollback

If sign-ups need to stop instantly: clear `ALLOWED_SIGNUP_DOMAINS` (existing
users keep working, no new ones can join). To pull the whole feature: keep
serving `main` (which doesn't have the multi-user branch) until issues are
resolved — the migrations are additive and don't break the single-user app.
