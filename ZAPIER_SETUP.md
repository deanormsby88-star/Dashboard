# Zapier Setup for DeanOS

Phase 1 Zaps: Circleback ingestion (Zap 1), Todoist task creation with
callback (Zap 2), optional Todoist update/complete executors (Zaps 3–4).
Phase 2 Zaps: email ingestion for Heya Outlook, JIC Outlook and Gmail
(Zaps 5–7, below). Calendar and the daily brief are later phases.

## Prerequisites

- DeanOS deployed and reachable (e.g. `https://deanos.example.com`). For local
  testing, use a tunnel (`ngrok`, `cloudflared`).
- `ZAPIER_WEBHOOK_SECRET` set in the DeanOS environment. Generate one:
  `openssl rand -hex 32`. You will paste this same value into request headers
  in every Zap below.

Every request between Zapier and DeanOS carries the header:

```text
X-DeanOS-Secret: <ZAPIER_WEBHOOK_SECRET value>
```

Requests without it are rejected with 401.

---

## Zap 1 — Circleback Meeting Ingestion

**Trigger:** Circleback automation (already tested). Configure the Circleback
automation to send the meeting to Zapier after every meeting.

**Action:** Webhooks by Zapier → **Custom Request**

- Method: `POST`
- URL: `https://<your-app>/api/webhooks/zapier/circleback`
- Data Pass-Through: no
- Data (JSON) — map the Circleback fields:

```json
{
  "meetingId": "<Circleback meeting ID>",
  "title": "<Meeting title>",
  "meetingDate": "<Meeting date>",
  "attendees": "<Attendees>",
  "notes": "<Meeting notes>",
  "transcript": "<Transcript>",
  "actionItems": "<Action items>",
  "sourceUrl": "<Meeting URL, if available>"
}
```

- Headers:
  - `Content-Type: application/json`
  - `X-DeanOS-Secret: <secret>`
  - `X-Idempotency-Key: <Circleback meeting ID>`  ← recommended; guarantees
    replays of the same meeting are absorbed even if the payload differs
    slightly between retries.

Notes:

- Field names are flexible — DeanOS also accepts `meeting_id`,
  `meeting_title`, `action_items`, etc., and accepts attendees/action items
  as arrays or as newline/comma-separated strings (Zapier often flattens
  lists to strings).
- A `200` response with `"processing": {"status": "processed"}` means the
  meeting was extracted successfully. `"status": "failed"` means the meeting
  was stored and can be retried from the DeanOS UI — do not re-send.

**Test:** send a sample meeting, then check DeanOS → Meetings. The meeting
should appear with extracted tasks. Send the exact same test again: DeanOS
responds `{"ok":true,"duplicate":true}` and creates nothing (this is the
replay test from the acceptance criteria).

---

## Zap 2 — Todoist Task Executor (create + callback)

**Trigger:** Webhooks by Zapier → **Catch Hook**.
Copy the generated Catch Hook URL into the DeanOS environment as
`ZAPIER_TODOIST_CREATE_HOOK_URL`.

DeanOS sends this payload when Dean approves a task:

```json
{
  "action": "create",
  "deanos_task_id": "…",
  "title": "Review June discrepancy report",
  "project_id": "6h4cX6qV6VRX9gQ8",
  "description": "…source, meeting, date, people, source URL…",
  "priority": 3,
  "due_date": "2026-07-10",
  "labels": [],
  "source_system": "circleback",
  "source_record_id": "cb-meeting-1001",
  "source_url": "https://app.circleback.ai/meeting/…",
  "dedup_key": "…sha256…",
  "callback_url": "https://<your-app>/api/webhooks/zapier/todoist"
}
```

**Step 2 (action):** Todoist → **Create Task**

- Task: `title`
- Project: map from `project_id`. `project_id` may be empty (Personal tasks
  go to the Todoist Inbox until a validated Personal project ID exists) — in
  Todoist's Zapier action, leaving Project blank targets the Inbox.
- Description/Note: `description`
- Priority: map `priority` (DeanOS already uses Todoist semantics:
  4 = urgent … 1 = backlog. Note Todoist's *UI* labels p1–p4 in the opposite
  order; the API value is what Zapier wants).
- Due date: `due_date` (often blank — never set a default).
- Labels: `labels`.

**Step 3 (action):** Webhooks by Zapier → **Custom Request** — the callback
that returns the Todoist task ID to DeanOS (acceptance criterion 10):

- Method: `POST`
- URL: `callback_url` (mapped from the Catch Hook payload)
- Headers: `Content-Type: application/json`, `X-DeanOS-Secret: <secret>`
- Data:

```json
{
  "action": "created",
  "deanos_task_id": "<deanos_task_id from step 1>",
  "dedup_key": "<dedup_key from step 1>",
  "todoist_task_id": "<Todoist task ID from step 2>",
  "todoist_task_url": "<Todoist task URL from step 2>"
}
```

After this callback, the task shows **created** in DeanOS with an
"open in Todoist" link.

---

## Zap 3 — Todoist Update Executor (optional in Phase 1)

Catch Hook → Todoist **Update Task**. Copy the hook URL into
`ZAPIER_TODOIST_UPDATE_HOOK_URL`. DeanOS sends:

```json
{ "action": "update", "todoist_task_id": "…", "title": "…", "priority": 3,
  "due_date": "2026-07-15", "description": "…", "project_id": "…" }
```

Only map fields that are present.

## Zap 4 — Todoist Completion Executor (optional in Phase 1)

Catch Hook → Todoist **Complete Task**. Copy the hook URL into
`ZAPIER_TODOIST_COMPLETE_HOOK_URL`. DeanOS sends:

```json
{ "action": "complete", "todoist_task_id": "…" }
```

Optionally add the same callback step as Zap 2 with
`{"action": "completed", "todoist_task_id": "…"}` so DeanOS reflects
completions done from Todoist's side too.

---

## Zaps 5–7 — Email ingestion (Heya Outlook, JIC Outlook, Gmail)

One Zap per mailbox; all three post to the same DeanOS endpoint with a
different hard-coded `mailbox` value. The recommended trigger is
**folder/label based**: create a folder (Outlook) or label (Gmail) called
`DeanOS` and move/label emails you want processed — deliberate and
low-noise. Do not trigger on every incoming email.

### Zap 5 — Heya Outlook (`deano@heya.team`)

**Trigger:** Microsoft Outlook → **New Email** → connect the Heya account →
Folder: `DeanOS`.

**Action:** Webhooks by Zapier → **POST**

- URL: `https://deanos-nu.vercel.app/api/webhooks/zapier/email`
- Payload Type: `json`
- Data:

  | name | value |
  |---|---|
  | `mailbox` | type `heya` |
  | `from` | sender/from field |
  | `to` | recipient(s) field |
  | `subject` | subject |
  | `body` | body (plain text if offered, otherwise HTML body — DeanOS strips HTML) |
  | `date` | received date/time |
  | `messageId` | Message ID / Internet Message ID (skip if not offered) |
  | `threadId` | Conversation ID (skip if not offered) |
  | `sourceUrl` | web link to the email (skip if not offered) |

- Headers:
  - `X-DeanOS-Secret: <secret>`
  - `X-Idempotency-Key`: the Message ID field (skip if not offered — DeanOS
    derives one)

### Zap 6 — JIC Outlook (`dean@justimagineconsulting.co.za`)

Identical to Zap 5, but connect the JIC Outlook account and set
`mailbox` = `jic`.

### Zap 7 — Gmail (`dean.ormsby88@gmail.com`)

**Trigger:** Gmail → **New Labeled Email** → label `DeanOS`.
Action identical to Zap 5 with `mailbox` = `personal`.

### What DeanOS does with each email

The Email Processor classifies it (Action / Waiting On / Risk / Reference /
Relationship Update / Ignore), suggests a task where warranted (never for
newsletters or notifications, never inventing deadlines), records waiting-on
items, and — for inbound replies that substantively deliver something Dean
was waiting for — automatically marks the matching waiting-on item done and
completes its follow-up task in Todoist (via Zap 4, if configured). Results
land in **Inbox** in the app.

## Todoist project IDs

```text
Heya:     6h4cX6qV6VRX9gQ8
JIC:      6Crg2Ch856x5xC46
Personal: (none yet — tasks go to the Todoist Inbox)
```

These are seeded into the DeanOS `businesses` table on first run.

## Troubleshooting

- **401** — missing/wrong `X-DeanOS-Secret`, or a stale `X-DeanOS-Timestamp`
  header if you chose to send one.
- **422** — payload failed validation. The event is stored: DeanOS →
  Settings → Webhook log shows the exact error and raw payload, with a Retry
  button once the Zap mapping is fixed (retry re-reads the stored payload).
- **Duplicates** — replaying an identical payload (or reusing an
  idempotency key) returns `{"ok":true,"duplicate":true}` by design.
- Every inbound request that passed authentication appears in the webhook
  log — if you can't see it there, the request never reached DeanOS.
