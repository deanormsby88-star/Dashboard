# DeanOS

Private, single-user executive operating system and AI Chief of Staff for
Dean Ormsby. Phase 1 implements the core loop end to end:

**Circleback meeting → Zapier → DeanOS → OpenAI extraction → review →
Zapier → Todoist (with the task ID stored back).**

- `ARCHITECTURE.md` — system design and module map
- `ZAPIER_SETUP.md` — exact Zap configuration
- `SECURITY.md` — auth, webhook security, data flows
- `ASSUMPTIONS.md` — decisions made where the brief left room

## Stack

Next.js 14 (App Router, strict TypeScript), Tailwind CSS, PostgreSQL (`pg` +
SQL migrations), OpenAI Responses API (strict structured output, Zod-validated),
Vitest. Deploys to Vercel with Supabase-hosted Postgres.

## Getting started

```bash
npm install

# 1. Configure environment
cp .env.example .env.local
#    - DATABASE_URL: Postgres connection string (Supabase: use the pooler URL on Vercel)
#    - SESSION_SECRET: openssl rand -base64 48
#    - ZAPIER_WEBHOOK_SECRET: openssl rand -hex 32
#    - DEANOS_PASSWORD_HASH: npm run hash-password -- 'your-password'
#    - OPENAI_API_KEY

# 2. Create the schema
npm run migrate

# 3. Run
npm run dev        # http://localhost:3000 — sign in with DEANOS_EMAIL + password
```

Then follow `ZAPIER_SETUP.md` to connect Circleback and Todoist.

## Development

```bash
npm run typecheck   # strict TS
npm test            # vitest: dedup, webhook security, ingestion, prompt schemas
npm run migrate     # apply pending SQL migrations
```

## Phase 1 acceptance walkthrough

1. A Circleback meeting ends; its automation sends the payload to Zapier.
2. Zapier POSTs to `/api/webhooks/zapier/circleback` with the shared secret.
3. DeanOS stores the raw payload (`source_records`, `webhook_events`).
4. The Meeting Processor extracts tasks, commitments, waiting-on items,
   decisions, risks and relationship updates (all Zod-validated; every model
   call logged in `ai_runs`).
5. **Meetings → open the meeting** shows the extracted results for review.
6. Approve a task → DeanOS posts it to the Zapier Todoist-create hook.
7. Zapier creates the task in the correct Todoist project and calls back
   with the Todoist task ID and URL, which DeanOS stores (status `created`,
   "open in Todoist" link).
8. Replaying the same Circleback payload returns `duplicate: true` and
   creates nothing.

Failures at any step are visible (Settings → Webhook log, meeting page,
task cards) and retryable. Nothing is silently dropped.

## Project structure

See `ARCHITECTURE.md` for the full module map. Highlights:

```text
db/migrations/            SQL schema (npm run migrate)
src/lib/ai/prompts/       versioned prompts with input/output schemas + fixtures
src/lib/ingest/           webhook ingestion pipeline
src/lib/processors/       Meeting Processor orchestration
src/app/api/webhooks/     inbound Zapier endpoints
src/app/api/actions/      outbound Todoist actions (via Zapier Catch Hooks)
tests/                    unit + integration tests, Circleback fixtures
```
