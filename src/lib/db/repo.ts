import type { Pool, PoolClient } from "pg";
import { getPool } from "@/lib/db";
import { getEnv } from "@/lib/env";
import type {
  Business,
  BusinessKey,
  Commitment,
  Decision,
  Interaction,
  Meeting,
  Person,
  Risk,
  Task,
  TaskStatus,
  User,
  WebhookEvent,
} from "@/lib/types";

type Queryable = Pool | PoolClient;

// Known Todoist project IDs from the brief. Personal intentionally has no
// project ID — tasks go to the Todoist Inbox until a validated ID exists.
export const BUSINESS_SEED: Array<{ key: BusinessKey; name: string; todoistProjectId: string | null }> = [
  { key: "heya", name: "Heya", todoistProjectId: "6h4cX6qV6VRX9gQ8" },
  { key: "jic", name: "JIC", todoistProjectId: "6Crg2Ch856x5xC46" },
  { key: "personal", name: "Personal", todoistProjectId: null },
];

export interface Owner {
  user: User;
  businesses: Business[];
}

/**
 * Get-or-create the single DeanOS user (from DEANOS_EMAIL) and the three
 * business contexts. Called from webhooks too, since events can arrive
 * before Dean ever logs in.
 */
export async function ensureOwner(db: Queryable = getPool()): Promise<Owner> {
  const email = getEnv().DEANOS_EMAIL.toLowerCase();
  const userRes = await db.query<User>(
    `insert into users (email, name) values ($1, $2)
     on conflict (email) do update set email = excluded.email
     returning id, email, name`,
    [email, "Dean Ormsby"]
  );
  const user = userRes.rows[0];

  for (const b of BUSINESS_SEED) {
    await db.query(
      `insert into businesses (user_id, key, name, todoist_project_id)
       values ($1, $2, $3, $4)
       on conflict (user_id, key) do nothing`,
      [user.id, b.key, b.name, b.todoistProjectId]
    );
  }
  const bizRes = await db.query<Business>(
    `select id, user_id, key, name, todoist_project_id from businesses where user_id = $1`,
    [user.id]
  );
  return { user, businesses: bizRes.rows };
}

export function businessByKey(owner: Owner, key: string | null | undefined): Business | null {
  if (!key) return null;
  return owner.businesses.find((b) => b.key === key) ?? null;
}

// ── Webhook events ────────────────────────────────────────────────────────────

export async function recordWebhookEvent(params: {
  endpoint: string;
  idempotencyKey: string;
  payload: unknown | null;
  rawBody: string | null;
}): Promise<{ id: string; duplicate: boolean }> {
  const db = getPool();
  const res = await db.query<{ id: string }>(
    `insert into webhook_events (endpoint, idempotency_key, payload, raw_body)
     values ($1, $2, $3, $4)
     on conflict (idempotency_key) do nothing
     returning id`,
    [params.endpoint, params.idempotencyKey, params.payload === null ? null : JSON.stringify(params.payload), params.rawBody]
  );
  if (res.rows.length > 0) return { id: res.rows[0].id, duplicate: false };
  const existing = await db.query<{ id: string }>(
    `select id from webhook_events where idempotency_key = $1`,
    [params.idempotencyKey]
  );
  return { id: existing.rows[0].id, duplicate: true };
}

export async function updateWebhookEvent(
  id: string,
  status: WebhookEvent["status"],
  error?: string | null
): Promise<void> {
  await getPool().query(
    `update webhook_events set status = $2, error = $3, processed_at = now() where id = $1`,
    [id, status, error ?? null]
  );
}

export async function getWebhookEvent(id: string): Promise<WebhookEvent | null> {
  const res = await getPool().query<WebhookEvent>(
    `select * from webhook_events where id = $1`,
    [id]
  );
  return res.rows[0] ?? null;
}

export async function listWebhookEvents(limit = 50): Promise<WebhookEvent[]> {
  const res = await getPool().query<WebhookEvent>(
    `select * from webhook_events order by received_at desc limit $1`,
    [limit]
  );
  return res.rows;
}

// ── Source records & meetings ────────────────────────────────────────────────

export async function upsertSourceRecord(params: {
  userId: string;
  sourceSystem: string;
  sourceRecordId: string;
  payload: unknown;
}): Promise<string> {
  const res = await getPool().query<{ id: string }>(
    `insert into source_records (user_id, source_system, source_record_id, payload)
     values ($1, $2, $3, $4)
     on conflict (user_id, source_system, source_record_id)
       do update set payload = excluded.payload, received_at = now()
     returning id`,
    [params.userId, params.sourceSystem, params.sourceRecordId, JSON.stringify(params.payload)]
  );
  return res.rows[0].id;
}

export async function upsertMeeting(params: {
  userId: string;
  sourceSystem: string;
  sourceRecordId: string;
  sourceUrl: string | null;
  title: string;
  meetingDate: Date | null;
  notes: string;
  transcript: string;
}): Promise<{ meeting: Meeting; created: boolean }> {
  const db = getPool();
  const res = await db.query<Meeting & { inserted: boolean }>(
    `insert into meetings
       (user_id, source_system, source_record_id, source_url, title, meeting_date, notes, transcript)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (user_id, source_system, source_record_id) do update set
       source_url = excluded.source_url,
       title = excluded.title,
       meeting_date = excluded.meeting_date,
       notes = excluded.notes,
       transcript = excluded.transcript,
       updated_at = now()
     returning *, (xmax = 0) as inserted`,
    [
      params.userId,
      params.sourceSystem,
      params.sourceRecordId,
      params.sourceUrl,
      params.title,
      params.meetingDate,
      params.notes,
      params.transcript,
    ]
  );
  const row = res.rows[0];
  return { meeting: row, created: row.inserted };
}

export async function replaceMeetingAttendees(
  meetingId: string,
  attendees: Array<{ name: string | null; email: string | null }>
): Promise<void> {
  const db = getPool();
  await db.query(`delete from meeting_attendees where meeting_id = $1`, [meetingId]);
  for (const a of attendees) {
    await db.query(
      `insert into meeting_attendees (meeting_id, name, email) values ($1, $2, $3)`,
      [meetingId, a.name, a.email]
    );
  }
}

export async function getMeeting(id: string): Promise<Meeting | null> {
  const res = await getPool().query<Meeting>(`select * from meetings where id = $1`, [id]);
  return res.rows[0] ?? null;
}

export async function listMeetings(limit = 100): Promise<Meeting[]> {
  const res = await getPool().query<Meeting>(
    `select * from meetings order by coalesce(meeting_date, created_at) desc limit $1`,
    [limit]
  );
  return res.rows;
}

export async function getMeetingAttendees(
  meetingId: string
): Promise<Array<{ name: string | null; email: string | null }>> {
  const res = await getPool().query<{ name: string | null; email: string | null }>(
    `select name, email from meeting_attendees where meeting_id = $1`,
    [meetingId]
  );
  return res.rows;
}

export async function getSourceRecordPayload(
  userId: string,
  sourceSystem: string,
  sourceRecordId: string
): Promise<unknown | null> {
  const res = await getPool().query<{ payload: unknown }>(
    `select payload from source_records
     where user_id = $1 and source_system = $2 and source_record_id = $3`,
    [userId, sourceSystem, sourceRecordId]
  );
  return res.rows[0]?.payload ?? null;
}

export async function setMeetingProcessing(
  id: string,
  status: Meeting["processing_status"],
  fields?: {
    error?: string | null;
    businessId?: string | null;
    summary?: string | null;
    recommendedFollowUp?: string | null;
  }
): Promise<void> {
  await getPool().query(
    `update meetings set
       processing_status = $2,
       processing_error = $3,
       business_id = coalesce($4, business_id),
       summary = coalesce($5, summary),
       recommended_follow_up = coalesce($6, recommended_follow_up),
       updated_at = now()
     where id = $1`,
    [id, status, fields?.error ?? null, fields?.businessId ?? null, fields?.summary ?? null, fields?.recommendedFollowUp ?? null]
  );
}

/**
 * Clears extracted records for a meeting before reprocessing so a retry
 * never double-inserts. Tasks that already left the building (sent/created)
 * are kept — dedup keys prevent re-suggesting them.
 */
export async function clearSuggestedExtractions(meetingId: string): Promise<void> {
  const db = getPool();
  await db.query(`delete from tasks where meeting_id = $1 and status = 'suggested'`, [meetingId]);
  await db.query(`delete from commitments where meeting_id = $1 and linked_task_id is null`, [meetingId]);
  await db.query(`delete from decisions where meeting_id = $1`, [meetingId]);
  await db.query(`delete from risks where meeting_id = $1 and status = 'open'`, [meetingId]);
  await db.query(`delete from interactions where meeting_id = $1`, [meetingId]);
}

// ── Tasks ────────────────────────────────────────────────────────────────────

export async function insertTask(params: {
  userId: string;
  businessId: string | null;
  meetingId: string | null;
  title: string;
  description: string;
  priority: number;
  dueDate: string | null;
  labels: string[];
  origin: Task["origin"];
  confidence: number | null;
  sourceSystem: string | null;
  sourceRecordId: string | null;
  sourceUrl: string | null;
  dedupKey: string;
  aiRunId: string | null;
}): Promise<{ task: Task | null; duplicate: boolean }> {
  const res = await getPool().query<Task>(
    `insert into tasks
       (user_id, business_id, meeting_id, title, description, priority, due_date, labels,
        origin, confidence, source_system, source_record_id, source_url, dedup_key, ai_run_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     on conflict (user_id, dedup_key) do nothing
     returning *`,
    [
      params.userId,
      params.businessId,
      params.meetingId,
      params.title,
      params.description,
      params.priority,
      params.dueDate,
      params.labels,
      params.origin,
      params.confidence,
      params.sourceSystem,
      params.sourceRecordId,
      params.sourceUrl,
      params.dedupKey,
      params.aiRunId,
    ]
  );
  if (res.rows.length === 0) return { task: null, duplicate: true };
  return { task: res.rows[0], duplicate: false };
}

export async function getTask(id: string): Promise<Task | null> {
  const res = await getPool().query<Task>(`select * from tasks where id = $1`, [id]);
  return res.rows[0] ?? null;
}

export async function listTasks(filter?: { status?: TaskStatus; meetingId?: string }): Promise<Task[]> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (filter?.status) {
    values.push(filter.status);
    clauses.push(`status = $${values.length}`);
  }
  if (filter?.meetingId) {
    values.push(filter.meetingId);
    clauses.push(`meeting_id = $${values.length}`);
  }
  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const res = await getPool().query<Task>(
    `select * from tasks ${where} order by created_at desc limit 200`,
    values
  );
  return res.rows;
}

/** Titles of tasks that still represent live work, for cross-meeting dedup. */
export async function listActiveTaskTitles(
  userId: string
): Promise<Array<{ id: string; title: string }>> {
  const res = await getPool().query<{ id: string; title: string }>(
    `select id, title from tasks
     where user_id = $1 and status in ('suggested', 'approved', 'sent', 'created')`,
    [userId]
  );
  return res.rows;
}

export async function updateTaskFields(
  id: string,
  fields: {
    title?: string;
    description?: string;
    priority?: number;
    dueDate?: string | null;
    labels?: string[];
    businessId?: string | null;
  }
): Promise<Task | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];
  const push = (sql: string, v: unknown) => {
    values.push(v);
    sets.push(`${sql} = $${values.length}`);
  };
  if (fields.title !== undefined) push("title", fields.title);
  if (fields.description !== undefined) push("description", fields.description);
  if (fields.priority !== undefined) push("priority", fields.priority);
  if (fields.dueDate !== undefined) push("due_date", fields.dueDate);
  if (fields.labels !== undefined) push("labels", fields.labels);
  if (fields.businessId !== undefined) push("business_id", fields.businessId);
  if (sets.length === 0) return getTask(id);
  const res = await getPool().query<Task>(
    `update tasks set ${sets.join(", ")}, updated_at = now() where id = $1 returning *`,
    values
  );
  return res.rows[0] ?? null;
}

export async function setTaskStatus(
  id: string,
  status: TaskStatus,
  error?: string | null
): Promise<Task | null> {
  const res = await getPool().query<Task>(
    `update tasks set status = $2, status_error = $3, updated_at = now() where id = $1 returning *`,
    [id, status, error ?? null]
  );
  return res.rows[0] ?? null;
}

/** Called by the Todoist callback webhook once Zapier reports the created task. */
export async function markTaskCreatedByDedupKey(params: {
  dedupKey?: string | null;
  taskId?: string | null;
  todoistTaskId: string;
  todoistTaskUrl: string | null;
}): Promise<Task | null> {
  const db = getPool();
  if (params.taskId) {
    const res = await db.query<Task>(
      `update tasks set status = 'created', todoist_task_id = $2, todoist_task_url = $3,
         status_error = null, updated_at = now()
       where id = $1 returning *`,
      [params.taskId, params.todoistTaskId, params.todoistTaskUrl]
    );
    return res.rows[0] ?? null;
  }
  if (params.dedupKey) {
    const res = await db.query<Task>(
      `update tasks set status = 'created', todoist_task_id = $2, todoist_task_url = $3,
         status_error = null, updated_at = now()
       where dedup_key = $1 returning *`,
      [params.dedupKey, params.todoistTaskId, params.todoistTaskUrl]
    );
    return res.rows[0] ?? null;
  }
  return null;
}

export async function completeTaskByTodoistId(todoistTaskId: string): Promise<Task | null> {
  const res = await getPool().query<Task>(
    `update tasks set status = 'completed', updated_at = now()
     where todoist_task_id = $1 returning *`,
    [todoistTaskId]
  );
  return res.rows[0] ?? null;
}

// ── Commitments / decisions / risks / interactions ──────────────────────────

export async function insertCommitment(params: {
  userId: string;
  businessId: string | null;
  meetingId: string | null;
  direction: Commitment["direction"];
  text: string;
  personName: string | null;
  personId: string | null;
  dateMade: Date | null;
  dueDate: string | null;
  confidence: number | null;
  linkedTaskId: string | null;
  sourceSystem: string | null;
  sourceRecordId: string | null;
  sourceUrl: string | null;
  dedupKey: string;
}): Promise<{ duplicate: boolean }> {
  const res = await getPool().query(
    `insert into commitments
       (user_id, business_id, meeting_id, direction, text, person_name, person_id,
        date_made, due_date, confidence, linked_task_id,
        source_system, source_record_id, source_url, dedup_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     on conflict (user_id, dedup_key) do nothing
     returning id`,
    [
      params.userId,
      params.businessId,
      params.meetingId,
      params.direction,
      params.text,
      params.personName,
      params.personId,
      params.dateMade,
      params.dueDate,
      params.confidence,
      params.linkedTaskId,
      params.sourceSystem,
      params.sourceRecordId,
      params.sourceUrl,
      params.dedupKey,
    ]
  );
  return { duplicate: res.rows.length === 0 };
}

export async function listCommitmentsForMeeting(meetingId: string): Promise<Commitment[]> {
  const res = await getPool().query<Commitment>(
    `select * from commitments where meeting_id = $1 order by direction, created_at`,
    [meetingId]
  );
  return res.rows;
}

export async function listDecisionsForMeeting(meetingId: string): Promise<Decision[]> {
  const res = await getPool().query<Decision>(
    `select * from decisions where meeting_id = $1 order by created_at`,
    [meetingId]
  );
  return res.rows;
}

export async function listRisksForMeeting(meetingId: string): Promise<Risk[]> {
  const res = await getPool().query<Risk>(
    `select * from risks where meeting_id = $1 order by created_at`,
    [meetingId]
  );
  return res.rows;
}

export async function listCommitments(direction?: Commitment["direction"]): Promise<Commitment[]> {
  const res = direction
    ? await getPool().query<Commitment>(
        `select * from commitments where direction = $1 order by created_at desc limit 200`,
        [direction]
      )
    : await getPool().query<Commitment>(
        `select * from commitments order by created_at desc limit 200`
      );
  return res.rows;
}

export async function insertDecision(params: {
  userId: string;
  businessId: string | null;
  meetingId: string | null;
  text: string;
  decidedOn: Date | null;
  confidence: number | null;
  sourceSystem: string | null;
  sourceRecordId: string | null;
  sourceUrl: string | null;
}): Promise<void> {
  await getPool().query(
    `insert into decisions
       (user_id, business_id, meeting_id, text, decided_on, confidence,
        source_system, source_record_id, source_url)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      params.userId,
      params.businessId,
      params.meetingId,
      params.text,
      params.decidedOn,
      params.confidence,
      params.sourceSystem,
      params.sourceRecordId,
      params.sourceUrl,
    ]
  );
}

export async function listDecisions(limit = 100): Promise<Decision[]> {
  const res = await getPool().query<Decision>(
    `select * from decisions order by created_at desc limit $1`,
    [limit]
  );
  return res.rows;
}

export async function insertRisk(params: {
  userId: string;
  businessId: string | null;
  meetingId: string | null;
  description: string;
  severity: Risk["severity"];
  confidence: number | null;
  sourceSystem: string | null;
  sourceRecordId: string | null;
  sourceUrl: string | null;
}): Promise<void> {
  await getPool().query(
    `insert into risks
       (user_id, business_id, meeting_id, description, severity, confidence,
        source_system, source_record_id, source_url)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      params.userId,
      params.businessId,
      params.meetingId,
      params.description,
      params.severity,
      params.confidence,
      params.sourceSystem,
      params.sourceRecordId,
      params.sourceUrl,
    ]
  );
}

export async function listRisks(): Promise<Risk[]> {
  const res = await getPool().query<Risk>(
    `select * from risks order by created_at desc limit 200`
  );
  return res.rows;
}

export async function getOrCreatePersonByName(userId: string, fullName: string): Promise<Person> {
  const db = getPool();
  const existing = await db.query<Person>(
    `select * from people where user_id = $1 and lower(full_name) = lower($2) limit 1`,
    [userId, fullName]
  );
  if (existing.rows.length > 0) return existing.rows[0];
  const res = await db.query<Person>(
    `insert into people (user_id, full_name) values ($1, $2) returning *`,
    [userId, fullName]
  );
  return res.rows[0];
}

export async function listPeople(): Promise<Person[]> {
  const res = await getPool().query<Person>(
    `select * from people order by full_name asc limit 500`
  );
  return res.rows;
}

export async function insertInteraction(params: {
  userId: string;
  personId: string | null;
  personName: string | null;
  meetingId: string | null;
  kind: Interaction["kind"] extends string ? string : never;
  summary: string;
  occurredAt: Date | null;
  confidence: number | null;
  sourceSystem: string | null;
  sourceRecordId: string | null;
  sourceUrl: string | null;
}): Promise<void> {
  await getPool().query(
    `insert into interactions
       (user_id, person_id, person_name, meeting_id, kind, summary, occurred_at, confidence,
        source_system, source_record_id, source_url)
     values ($1,$2,$3,$4,$5,$6,coalesce($7, now()),$8,$9,$10,$11)`,
    [
      params.userId,
      params.personId,
      params.personName,
      params.meetingId,
      params.kind,
      params.summary,
      params.occurredAt,
      params.confidence,
      params.sourceSystem,
      params.sourceRecordId,
      params.sourceUrl,
    ]
  );
}

export async function listInteractionsForMeeting(meetingId: string): Promise<Interaction[]> {
  const res = await getPool().query<Interaction>(
    `select * from interactions where meeting_id = $1 order by created_at desc`,
    [meetingId]
  );
  return res.rows;
}

// ── AI runs ──────────────────────────────────────────────────────────────────

export async function insertAiRun(params: {
  userId: string | null;
  promptName: string;
  promptVersion: string;
  model: string;
  input: unknown;
  rawOutput: string | null;
  parsedOutput: unknown | null;
  status: "ok" | "parse_failed" | "api_failed";
  error: string | null;
  usage: unknown | null;
}): Promise<string> {
  const res = await getPool().query<{ id: string }>(
    `insert into ai_runs
       (user_id, prompt_name, prompt_version, model, input, raw_output, parsed_output, status, error, usage)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     returning id`,
    [
      params.userId,
      params.promptName,
      params.promptVersion,
      params.model,
      params.input === null ? null : JSON.stringify(params.input),
      params.rawOutput,
      params.parsedOutput === null ? null : JSON.stringify(params.parsedOutput),
      params.status,
      params.error,
      params.usage === null ? null : JSON.stringify(params.usage),
    ]
  );
  return res.rows[0].id;
}

// ── Dashboard helpers ────────────────────────────────────────────────────────

export interface SyncStatusRow {
  endpoint: string;
  last_success: Date | null;
  last_failure: Date | null;
  failed_count: number;
}

export async function getSyncStatus(): Promise<SyncStatusRow[]> {
  const res = await getPool().query<SyncStatusRow>(
    `select endpoint,
            max(processed_at) filter (where status = 'processed') as last_success,
            max(received_at) filter (where status = 'failed') as last_failure,
            count(*) filter (where status = 'failed')::int as failed_count
     from webhook_events
     group by endpoint
     order by endpoint`
  );
  return res.rows;
}

export async function getCounts(): Promise<{
  suggestedTasks: number;
  failedMeetings: number;
  pendingMeetings: number;
  openCommitmentsByDean: number;
  openWaitingOn: number;
  openRisks: number;
}> {
  const res = await getPool().query<{
    suggested_tasks: number;
    failed_meetings: number;
    pending_meetings: number;
    by_dean: number;
    to_dean: number;
    open_risks: number;
  }>(
    `select
       (select count(*) from tasks where status = 'suggested')::int as suggested_tasks,
       (select count(*) from meetings where processing_status = 'failed')::int as failed_meetings,
       (select count(*) from meetings where processing_status in ('pending','processing'))::int as pending_meetings,
       (select count(*) from commitments where direction = 'by_dean' and status = 'open')::int as by_dean,
       (select count(*) from commitments where direction = 'to_dean' and status = 'open')::int as to_dean,
       (select count(*) from risks where status = 'open')::int as open_risks`
  );
  const r = res.rows[0];
  return {
    suggestedTasks: r.suggested_tasks,
    failedMeetings: r.failed_meetings,
    pendingMeetings: r.pending_meetings,
    openCommitmentsByDean: r.by_dean,
    openWaitingOn: r.to_dean,
    openRisks: r.open_risks,
  };
}
