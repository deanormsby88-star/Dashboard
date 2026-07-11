# DeanOS Security

DeanOS handles data from Heya (a secure corporate environment), JIC, and
Dean's personal life. This document describes the controls in place and what
data leaves which system.

## Access control

- Private, single-user app. The only login is `DEANOS_EMAIL` +
  password verified against `DEANOS_PASSWORD_HASH` (scrypt, random salt,
  constant-time comparison). Generate the hash with
  `npm run hash-password -- '<password>'` — the plaintext password is never
  stored or configured anywhere.
- Sessions are HMAC-SHA256-signed cookies (`httpOnly`, `SameSite=Lax`,
  `Secure` in production, 30-day expiry) signed with `SESSION_SECRET`.
- Middleware requires a valid session for every page and API route except
  `/login`, the auth API, and the webhook endpoints (which authenticate
  per-request, below). API routes additionally re-check the session
  themselves (defense in depth).

## Webhook security

- Every inbound webhook must present the shared secret in
  `X-DeanOS-Secret`; comparison is constant-time. Requests without it are
  rejected (401) and not stored.
- Idempotency: an explicit `X-Idempotency-Key` header, or a SHA-256 of the
  endpoint + raw body. Duplicate deliveries and replays are absorbed — the
  original event is never reprocessed.
- Replay protection: if `X-DeanOS-Timestamp` is sent, it must be within a
  5-minute window. Zapier cannot sign requests (no HMAC support in webhook
  steps), so shared secret + idempotency + optional timestamp is the
  practical ceiling; the secret should be long (32+ random bytes) and
  rotated if a Zap is ever shared or exported.
- All authenticated-but-invalid requests are preserved in `webhook_events`
  with the raw body for inspection — nothing is silently dropped.
- Fallback: the shared secret is also accepted as a `?secret=` query
  parameter, because some senders (Circleback's native webhook step) cannot
  set custom headers. Trade-off: URLs are more likely than headers to end
  up in intermediary logs. Prefer the header wherever the sender supports
  it, and rotate the secret if a URL containing it is ever shared.

## Data flows (what leaves which system)

| Flow | Data | Destination |
|---|---|---|
| Circleback → Zapier → DeanOS | meeting title, date, attendees, notes, transcript, action items | DeanOS database |
| DeanOS → OpenAI | meeting/email content, assistant chat context | OpenAI API (extraction + reasoning) |
| DeanOS → OpenAI web search | public identifiers only (name, role, company, topic) — never internal notes | OpenAI built-in web search |
| DeanOS → Zapier → Todoist | task title, description (source context), priority, due date, labels | Todoist |
| Zapier → DeanOS | Todoist task ID + URL | DeanOS database |

Nothing else leaves. No email content flows anywhere in Phase 1. The
Settings page shows each connection, its state, and what flows through it.

## Data separation

- Heya and JIC records are never mixed: every meeting, task, commitment,
  risk and decision carries a single `business_id`, and the Meeting
  Processor classifies each meeting into exactly one context (or `unknown`
  for Dean to resolve).

## Secrets and configuration

- All secrets live in environment variables (`.env.example` documents them;
  `.env*` is gitignored). No secrets in code, logs, or the database.
- The Settings page shows only *presence* of configuration, never values.
- OpenAI/Zapier keys are used server-side only; nothing sensitive is exposed
  through `NEXT_PUBLIC_*`.

## Logging and storage hygiene

- Application logs do not include payload bodies, transcripts, or secrets;
  errors stored on records are human-readable messages, not dumps.
- Raw payloads are retained in `source_records`/`webhook_events` for
  provenance and replay. Retention/deletion: Phase 1 supports manual
  deletion via SQL; automated retention rules are planned alongside Phase 2
  (recorded in ASSUMPTIONS.md).
- `ai_runs` keeps model inputs/outputs for auditability of every AI-derived
  item (source, confidence, timestamp are shown in the UI).

## Deployment

- Deploy behind HTTPS only (Vercel default). `APP_URL` starting with
  `https://` switches session cookies to `Secure`.
- Use a Supabase/Postgres instance with TLS and a strong password; restrict
  network access where the provider allows it.
- Keep `SESSION_SECRET`, `ZAPIER_WEBHOOK_SECRET`, `OPENAI_API_KEY` and
  `DATABASE_URL` in the hosting provider's encrypted env store.
