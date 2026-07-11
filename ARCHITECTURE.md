# DeanOS Architecture

DeanOS is a private, single-user executive operating system for Dean Ormsby.
It is the control centre and intelligence layer; Zapier is the integration and
execution layer; OpenAI is the reasoning layer. Todoist stays the system of
record for actionable work; Circleback stays the source for meeting
transcripts and action items; email stays in the original mail platforms.
DeanOS normalizes, indexes, enriches and acts on data — it does not duplicate
entire systems.

```text
DeanOS Web App (Next.js on Vercel)
    |
    |-- OpenAI API           reasoning, extraction, prioritization
    |-- Zapier               ingestion (Circleback, email, calendar) + Todoist execution
    |-- PostgreSQL           normalized records, sync state, provenance
```

## Stack

- Next.js 14 (App Router) + TypeScript (strict) + Tailwind CSS
- PostgreSQL via `pg` with hand-written SQL migrations (`db/migrations/`,
  applied by `npm run migrate`)
- OpenAI Responses API with strict JSON-schema structured output
- Single-user auth: scrypt-hashed password from env, HMAC-signed cookie
  sessions (Web Crypto, verified in middleware)

## Data flow: Circleback → Todoist (Phase 1)

```text
Circleback meeting completes
  → Circleback automation sends payload to Zapier (Zap 1)
  → Zapier POSTs to /api/webhooks/zapier/circleback  (shared secret header)
  → DeanOS records the webhook_event (idempotency key absorbs replays)
  → raw payload stored verbatim in source_records; meeting upserted
  → Meeting Processor runs (OpenAI structured extraction, Zod-validated)
  → tasks / commitments / waiting-on / decisions / risks / relationship
    updates stored with confidence + provenance; every model call logged
    in ai_runs
  → Dean reviews suggestions in the UI (approve / edit / reject)
  → approve → POST to Zapier Todoist-create Catch Hook (Zap 2)
  → Zapier creates the Todoist task, then calls back
    /api/webhooks/zapier/todoist with the Todoist task ID + URL
  → DeanOS stores the ID/URL against the task (status: created)
```

## Module map

```text
src/
  middleware.ts                  session gate for all pages/APIs except login + webhooks
  lib/
    env.ts                       Zod-validated environment access (lazy, fail-loud)
    types.ts                     domain row types
    db/index.ts                  pg pool (per-process singleton)
    db/repo.ts                   all SQL; owner bootstrap seeds user + businesses
    auth/session.ts              HMAC cookie tokens (Web Crypto — works in edge middleware)
    auth/password.ts             scrypt verification (node runtime)
    auth/require-session.ts      route-handler guard
    webhooks/security.ts         shared secret, timestamp freshness, idempotency keys
    circleback/schema.ts         payload model + normalizer for Zapier field variants
    ingest/circleback.ts         full ingestion pipeline (auth → idempotency → validate
                                 → store → process); every authenticated request is
                                 recorded in webhook_events, never silently dropped
    ai/openai.ts                 Responses API client (strict json_schema output)
    ai/prompts/meeting-processor.ts   versioned prompt: input/output Zod schemas,
                                 mirrored strict JSON schema, system prompt, parser
    processors/meeting.ts        orchestration: AI call, ai_runs logging, dedup,
                                 persistence, retry-safe reprocessing
    dedup.ts                     title normalization, similarity, dedup keys, merging
    todoist/zapier.ts            Catch Hook client for create/update/complete
  app/
    login/                       standalone login
    (app)/                       authenticated shell: Today, Inbox, Tasks, Meetings,
                                 People, Commitments, Risks, Businesses, Assistant,
                                 Settings
    api/webhooks/zapier/circleback   inbound meeting ingestion
    api/webhooks/zapier/todoist      Zapier callback (Todoist task ID/URL, completions)
    api/actions/todoist/{create,update,complete}   action endpoints → Zapier hooks
    api/tasks/[id]{,/approve,/reject}              review actions
    api/meetings/[id]/process                      reprocess/retry
    api/webhook-events/[id]/retry                  replay a stored failed event
```

## Database

Tables (see `db/migrations/0001_init.sql`): `users`, `businesses`, `people`,
`meetings`, `meeting_attendees`, `tasks`, `commitments`, `risks`, `decisions`,
`interactions`, `source_records`, `sync_runs`, `webhook_events`, `ai_runs`.

Conventions:

- Every domain row is scoped to `user_id` even though the MVP is single-user.
- Provenance on every derived record: `source_system`, `source_record_id`,
  `source_url`, plus `ai_run_id` on tasks.
- `dedup_key` with a DB unique constraint on tasks and commitments makes
  replays and reprocessing idempotent at the storage layer.
- Raw payloads are preserved verbatim (`source_records`, `webhook_events`).

## Deduplication (brief §8)

1. The Meeting Processor prompt merges formal action items with
   transcript-derived commitments into a single task list (`origin: both`).
2. `mergeExtractedTasks` merges near-duplicates within one extraction
   (normalized-title Jaccard similarity ≥ 0.75).
3. New suggestions are checked against all live DeanOS tasks
   (suggested/approved/sent/created) and skipped if they duplicate one.
4. `dedup_key` = sha256(source system + source record ID + normalized title);
   the unique constraint absorbs exact replays.
5. The dedup key travels with the task to Zapier and back, so the Todoist
   callback binds to exactly one task.

## Failure handling (brief §17, §23)

- AI parse failure: raw response stored in `ai_runs` (status `parse_failed`),
  meeting marked `failed` with the error, nothing executed downstream, retry
  button in the UI. Reprocessing clears prior *suggested* extractions first.
- Zapier hook failure: task marked `failed` with a human-readable error;
  approving again retries.
- Invalid webhook payloads: recorded in `webhook_events` as `failed` with the
  raw body preserved and a retry endpoint — never silently dropped.
- Unauthenticated webhook requests are rejected and not stored (they are
  probing noise, not lost events).

## Processing model

The Meeting Processor runs inline in the webhook request (`maxDuration = 60`).
This is the smallest reliable end-to-end path: no queue infrastructure, and a
failure leaves the meeting stored + retryable. If meetings outgrow the request
window, the next step is a queue table drained by a scheduled invocation —
the pipeline is already split (`ingest` vs `processMeeting`) to make that a
small change.

## Data flow: email (Phase 2)

```text
Email moved to the DeanOS folder/label (Heya Outlook, JIC Outlook, Gmail)
  → per-mailbox Zap POSTs to /api/webhooks/zapier/email with its mailbox context
  → same webhook guarantees as Circleback (secret, idempotency, raw storage)
  → Email Processor classifies: action / waiting_on / risk / reference /
    relationship_update / ignore  (src/lib/ai/prompts/email-processor.ts)
  → action → suggested task; waiting_on → to_dean commitment + "Follow up:" task;
    risk/relationship updates recorded; ignore/reference auto-filed
  → inbound replies that substantively deliver an awaited item mark the
    matching waiting-on commitment done and complete its Todoist task
  → everything surfaces in the Inbox page (mark handled / retry / reopen)
```

Email-specific modules: `lib/email/schema.ts` (normalizer, mailbox/direction
inference, HTML stripping), `lib/ingest/email.ts`, `lib/processors/email.ts`,
`app/api/webhooks/zapier/email`, `app/api/emails/[id]/{process,resolve}`.

## Assistant

One chat surface (`/assistant`, POST `/api/assistant`) with a deterministic
command router (`lib/assistant/commands.ts`):

- Deterministic commands read straight from Postgres: `waiting`,
  `commitments`, `risks`, `people [name]`, `slipping`, `forgetting`, `help`.
- AI commands build a compact state snapshot (`lib/assistant/state.ts`) and
  call versioned prompts: `focus`/`next`/`brief`/`sync` use
  `executive-prioritizer` (strict output, brief §13 priority order);
  `prep [x]` uses `meeting-prep` over a person bundle;
  `capture`/`remember` use `quick-capture` and then execute (tasks go
  straight to Todoist via the direct API); `review` and free-form questions
  use plain-text composition grounded in the snapshot.
- `sync` diffs against the last `sync_runs` row and reports
  Created/Updated/Closed/Escalated + Top 3, per brief §16; quiet syncs
  return "Sync complete. No material changes."
- Every model call is logged to `ai_runs`. Escalation rule: waiting-on
  items older than 3 business days are flagged everywhere they appear.

## Phase boundaries

Phase 1: Circleback → review → Todoist, end to end. ✅
Phase 2: email ingestion + processor, waiting-on tracking + resolution. ✅
Assistant (pulled forward from Phase 4): chat commands + prioritizer. ✅
Phase 3: calendar, meeting prep enrichment (public research), people profiles.
Phase 4 (remainder): Today dashboard Top 3 tiles, scheduled daily brief.

Later-phase pages exist as clearly-labelled placeholders so the shell doesn't
change underneath Dean as phases land.
