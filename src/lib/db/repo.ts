import type { Pool, PoolClient } from "pg";
import { getPool } from "@/lib/db";
import { getEnv } from "@/lib/env";
import type {
  Business,
  BusinessKey,
  Commitment,
  Decision,
  Email,
  EmailClassification,
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
  { key: "personal", name: "Personal", todoistProjectId: "6Crg2Ch83pFrmj7H" },
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
       on conflict (user_id, key) do update set
         name = excluded.name,
         todoist_project_id = excluded.todoist_project_id`,
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

/**
 * Task titles for deduplication. Deliberately includes rejected and
 * completed tasks: once Dean has dealt with (or dismissed) a piece of work,
 * a near-identical suggestion must never resurface from a later email or
 * meeting about the same matter.
 */
export async function listAllTaskTitles(
  userId: string
): Promise<Array<{ id: string; title: string; status: string }>> {
  const res = await getPool().query<{ id: string; title: string; status: string }>(
    `select id, title, status from tasks
     where user_id = $1
     order by created_at desc
     limit 1000`,
    [userId]
  );
  return res.rows;
}

/** Has Dean marked any other email in this thread as handled? */
export async function threadHasResolvedEmail(
  userId: string,
  threadId: string | null,
  excludeEmailId: string
): Promise<boolean> {
  if (!threadId) return false;
  const res = await getPool().query(
    `select 1 from emails
     where user_id = $1 and thread_id = $2 and id <> $3 and resolved = true
     limit 1`,
    [userId, threadId, excludeEmailId]
  );
  return res.rows.length > 0;
}

/** Reject any still-suggested tasks extracted from a given source record. */
export async function rejectSuggestedTasksForSource(
  userId: string,
  sourceRecordId: string,
  reason: string
): Promise<number> {
  const res = await getPool().query(
    `update tasks set status = 'rejected', status_error = $3, updated_at = now()
     where user_id = $1 and source_record_id = $2 and status = 'suggested'`,
    [userId, sourceRecordId, reason]
  );
  return res.rowCount ?? 0;
}

/** Retry-safety: drop suggested tasks from a source before re-extracting. */
export async function clearSuggestedTasksForSource(
  userId: string,
  sourceRecordId: string
): Promise<void> {
  await getPool().query(
    `delete from tasks where user_id = $1 and source_record_id = $2 and status = 'suggested'`,
    [userId, sourceRecordId]
  );
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

/** Get-or-create a person, reporting whether this call created them. */
export async function getOrCreatePerson(
  userId: string,
  fullName: string
): Promise<{ person: Person; created: boolean }> {
  const db = getPool();
  const existing = await db.query<Person>(
    `select * from people where user_id = $1 and lower(full_name) = lower($2) limit 1`,
    [userId, fullName]
  );
  if (existing.rows.length > 0) return { person: existing.rows[0], created: false };
  const res = await db.query<Person>(
    `insert into people (user_id, full_name) values ($1, $2) returning *`,
    [userId, fullName]
  );
  return { person: res.rows[0], created: true };
}

export async function getOrCreatePersonByName(userId: string, fullName: string): Promise<Person> {
  return (await getOrCreatePerson(userId, fullName)).person;
}

export async function updatePerson(
  id: string,
  fields: { fullName?: string; role?: string | null; organization?: string | null; email?: string | null; phone?: string | null; notes?: string | null }
): Promise<Person | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];
  const push = (col: string, v: unknown) => {
    values.push(v);
    sets.push(`${col} = $${values.length}`);
  };
  if (fields.fullName !== undefined && fields.fullName.trim()) push("full_name", fields.fullName.trim());
  if (fields.role !== undefined) push("role", fields.role);
  if (fields.organization !== undefined) push("organization", fields.organization);
  if (fields.email !== undefined) push("email", fields.email);
  if (fields.phone !== undefined) push("phone", fields.phone);
  if (fields.notes !== undefined) push("notes", fields.notes);
  if (sets.length === 0) return getPerson(id);
  const res = await getPool().query<Person>(
    `update people set ${sets.join(", ")}, updated_at = now() where id = $1 returning *`,
    values
  );
  return res.rows[0] ?? null;
}

export async function deletePerson(id: string): Promise<boolean> {
  const res = await getPool().query(`delete from people where id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function listPeople(): Promise<Person[]> {
  const res = await getPool().query<Person>(
    `select * from people order by full_name asc limit 500`
  );
  return res.rows;
}

export async function getPerson(id: string): Promise<Person | null> {
  const res = await getPool().query<Person>(`select * from people where id = $1`, [id]);
  return res.rows[0] ?? null;
}

/** People with lightweight counts for the directory. */
export async function listPeopleWithCounts(): Promise<
  Array<Person & { open_to_dean: number; open_by_dean: number; last_activity: Date | null }>
> {
  const res = await getPool().query(
    `select p.*,
       (select count(*) from commitments c where c.person_id = p.id and c.direction='to_dean' and c.status='open')::int as open_to_dean,
       (select count(*) from commitments c where c.person_id = p.id and c.direction='by_dean' and c.status='open')::int as open_by_dean,
       greatest(
         coalesce((select max(occurred_at) from interactions i where i.person_id = p.id), 'epoch'),
         coalesce((select max(created_at) from commitments c where c.person_id = p.id), 'epoch')
       ) as last_activity
     from people p order by last_activity desc nulls last, p.full_name asc limit 500`
  );
  return res.rows as never;
}

/** Full relationship bundle for one person by id (profile page). */
export async function getPersonBundleById(id: string): Promise<PersonBundle & { person: Person | null }> {
  const person = await getPerson(id);
  if (!person) return { person: null, interactions: [], commitments: [], meetings: [], emails: [] };
  const db = getPool();
  const like = `%${person.full_name}%`;
  const [interactions, commitments, meetings, emails] = await Promise.all([
    db.query<Interaction>(
      `select * from interactions where person_id = $1 or person_name ilike $2 order by occurred_at desc limit 40`,
      [person.id, like]
    ),
    db.query<Commitment>(
      `select * from commitments where person_id = $1 or person_name ilike $2 order by created_at desc limit 60`,
      [person.id, like]
    ),
    db.query<{ title: string; meeting_date: Date | null; summary: string | null }>(
      `select distinct m.title, m.meeting_date, m.summary
       from meetings m join meeting_attendees a on a.meeting_id = m.id
       where a.name ilike $1 or a.email ilike $1
       order by m.meeting_date desc nulls last limit 20`,
      [like]
    ),
    db.query<{ subject: string; summary: string | null; email_date: Date | null }>(
      `select subject, summary, email_date from emails where sender ilike $1 order by coalesce(email_date, created_at) desc limit 20`,
      [like]
    ),
  ]);
  return {
    person,
    interactions: interactions.rows,
    commitments: commitments.rows,
    meetings: meetings.rows,
    emails: emails.rows,
  };
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

// ── Emails ───────────────────────────────────────────────────────────────────

export async function upsertEmail(params: {
  userId: string;
  businessId: string | null;
  mailbox: BusinessKey;
  direction: "inbound" | "outbound";
  sender: string;
  recipients: string[];
  subject: string;
  bodyText: string;
  emailDate: Date | null;
  threadId: string | null;
  messageId: string;
  sourceUrl: string | null;
  flags: string[];
  attachments: unknown | null;
}): Promise<{ email: Email; created: boolean }> {
  const res = await getPool().query<Email & { inserted: boolean }>(
    `insert into emails
       (user_id, business_id, mailbox, direction, sender, recipients, subject, body_text,
        email_date, thread_id, message_id, source_url, flags, attachments)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     on conflict (user_id, message_id) do update set
       flags = excluded.flags,
       updated_at = now()
     returning *, (xmax = 0) as inserted`,
    [
      params.userId,
      params.businessId,
      params.mailbox,
      params.direction,
      params.sender,
      params.recipients,
      params.subject,
      params.bodyText,
      params.emailDate,
      params.threadId,
      params.messageId,
      params.sourceUrl,
      params.flags,
      params.attachments === null ? null : JSON.stringify(params.attachments),
    ]
  );
  const row = res.rows[0];
  return { email: row, created: row.inserted };
}

export async function getEmail(id: string): Promise<Email | null> {
  const res = await getPool().query<Email>(`select * from emails where id = $1`, [id]);
  return res.rows[0] ?? null;
}

export async function listEmails(filter?: {
  unresolvedOnly?: boolean;
  limit?: number;
}): Promise<Email[]> {
  const where = filter?.unresolvedOnly
    ? `where resolved = false and (classification is null or classification not in ('ignore','reference'))`
    : "";
  const res = await getPool().query<Email>(
    `select * from emails ${where} order by coalesce(email_date, created_at) desc limit $1`,
    [filter?.limit ?? 100]
  );
  return res.rows;
}

export async function setEmailProcessing(
  id: string,
  status: Email["processing_status"],
  fields?: {
    error?: string | null;
    classification?: EmailClassification | null;
    confidence?: number | null;
    summary?: string | null;
    suggestedTaskId?: string | null;
    resolved?: boolean;
  }
): Promise<void> {
  await getPool().query(
    `update emails set
       processing_status = $2,
       processing_error = $3,
       classification = coalesce($4, classification),
       confidence = coalesce($5, confidence),
       summary = coalesce($6, summary),
       suggested_task_id = coalesce($7, suggested_task_id),
       resolved = coalesce($8, resolved),
       updated_at = now()
     where id = $1`,
    [
      id,
      status,
      fields?.error ?? null,
      fields?.classification ?? null,
      fields?.confidence ?? null,
      fields?.summary ?? null,
      fields?.suggestedTaskId ?? null,
      fields?.resolved ?? null,
    ]
  );
}

export async function markEmailResolved(id: string, resolved: boolean): Promise<void> {
  await getPool().query(`update emails set resolved = $2, updated_at = now() where id = $1`, [
    id,
    resolved,
  ]);
}

/** Open waiting-on commitments, given to the Email Processor for resolution matching. */
export async function listOpenWaitingOn(
  userId: string
): Promise<Array<{ id: string; text: string; person_name: string | null; linked_task_id: string | null }>> {
  const res = await getPool().query<{
    id: string;
    text: string;
    person_name: string | null;
    linked_task_id: string | null;
  }>(
    `select id, text, person_name, linked_task_id from commitments
     where user_id = $1 and direction = 'to_dean' and status = 'open'
     order by created_at desc limit 100`,
    [userId]
  );
  return res.rows;
}

export async function markCommitmentDone(id: string): Promise<Commitment | null> {
  const res = await getPool().query<Commitment>(
    `update commitments set status = 'done', updated_at = now() where id = $1 returning *`,
    [id]
  );
  return res.rows[0] ?? null;
}

export async function getCommitment(id: string): Promise<Commitment | null> {
  const res = await getPool().query<Commitment>(`select * from commitments where id = $1`, [id]);
  return res.rows[0] ?? null;
}

export async function updateCommitment(
  id: string,
  fields: {
    text?: string;
    personName?: string | null;
    dueDate?: string | null;
    status?: "open" | "done" | "cancelled";
  }
): Promise<Commitment | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];
  const push = (sql: string, v: unknown) => {
    values.push(v);
    sets.push(`${sql} = $${values.length}`);
  };
  if (fields.text !== undefined) push("text", fields.text);
  if (fields.personName !== undefined) push("person_name", fields.personName);
  if (fields.dueDate !== undefined) push("due_date", fields.dueDate);
  if (fields.status !== undefined) push("status", fields.status);
  if (sets.length === 0) return getCommitment(id);
  const res = await getPool().query<Commitment>(
    `update commitments set ${sets.join(", ")}, updated_at = now() where id = $1 returning *`,
    values
  );
  return res.rows[0] ?? null;
}

export async function getRisk(id: string): Promise<Risk | null> {
  const res = await getPool().query<Risk>(`select * from risks where id = $1`, [id]);
  return res.rows[0] ?? null;
}

export async function updateRisk(
  id: string,
  fields: {
    description?: string;
    severity?: "low" | "medium" | "high";
    status?: "open" | "mitigated" | "closed";
  }
): Promise<Risk | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];
  const push = (sql: string, v: unknown) => {
    values.push(v);
    sets.push(`${sql} = $${values.length}`);
  };
  if (fields.description !== undefined) push("description", fields.description);
  if (fields.severity !== undefined) push("severity", fields.severity);
  if (fields.status !== undefined) push("status", fields.status);
  if (sets.length === 0) return getRisk(id);
  const res = await getPool().query<Risk>(
    `update risks set ${sets.join(", ")}, updated_at = now() where id = $1 returning *`,
    values
  );
  return res.rows[0] ?? null;
}

// ── Assistant support ────────────────────────────────────────────────────────

export async function countUnresolvedEmails(): Promise<number> {
  const res = await getPool().query<{ n: number }>(
    `select count(*)::int as n from emails
     where resolved = false and (classification is null or classification not in ('ignore','reference'))`
  );
  return res.rows[0].n;
}

export async function getLastSyncRun(sourceSystem: string): Promise<Date | null> {
  const res = await getPool().query<{ started_at: Date }>(
    `select started_at from sync_runs
     where source_system = $1 and status = 'succeeded'
     order by started_at desc limit 1`,
    [sourceSystem]
  );
  return res.rows[0]?.started_at ?? null;
}

export async function recordSyncRun(params: {
  userId: string;
  sourceSystem: string;
  stats: unknown;
}): Promise<void> {
  await getPool().query(
    `insert into sync_runs (user_id, source_system, status, stats, finished_at)
     values ($1, $2, 'succeeded', $3, now())`,
    [params.userId, params.sourceSystem, JSON.stringify(params.stats)]
  );
}

/** Recent succeeded sync_runs for a source (stats returned parsed — jsonb). */
export async function listSyncRunsBySource(
  sourceSystem: string,
  sinceDays = 45
): Promise<Array<{ stats: Record<string, unknown>; started_at: Date }>> {
  const res = await getPool().query<{ stats: Record<string, unknown>; started_at: Date }>(
    `select stats, started_at from sync_runs
     where source_system = $1 and status = 'succeeded'
       and started_at > now() - make_interval(days => $2)
     order by started_at desc limit 1000`,
    [sourceSystem, sinceDays]
  );
  return res.rows;
}

export interface RecentChanges {
  tasksCreated: Array<{ title: string; status: string }>;
  commitmentsOpened: Array<{ text: string; direction: string; person_name: string | null }>;
  commitmentsClosed: Array<{ text: string; person_name: string | null }>;
  risksOpened: Array<{ description: string; severity: string }>;
  meetingsProcessed: Array<{ title: string }>;
}

export async function getChangesSince(since: Date | null): Promise<RecentChanges> {
  const db = getPool();
  const cutoff = since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [tasks, opened, closed, risks, meetings] = await Promise.all([
    db.query<{ title: string; status: string }>(
      `select title, status from tasks where created_at > $1 order by created_at desc limit 30`,
      [cutoff]
    ),
    db.query<{ text: string; direction: string; person_name: string | null }>(
      `select text, direction, person_name from commitments where created_at > $1 order by created_at desc limit 30`,
      [cutoff]
    ),
    db.query<{ text: string; person_name: string | null }>(
      `select text, person_name from commitments where status = 'done' and updated_at > $1 order by updated_at desc limit 30`,
      [cutoff]
    ),
    db.query<{ description: string; severity: string }>(
      `select description, severity from risks where created_at > $1 order by created_at desc limit 20`,
      [cutoff]
    ),
    db.query<{ title: string }>(
      `select title from meetings where processing_status = 'processed' and updated_at > $1 order by updated_at desc limit 20`,
      [cutoff]
    ),
  ]);
  return {
    tasksCreated: tasks.rows,
    commitmentsOpened: opened.rows,
    commitmentsClosed: closed.rows,
    risksOpened: risks.rows,
    meetingsProcessed: meetings.rows,
  };
}

export async function findPersonByName(name: string): Promise<Person | null> {
  const res = await getPool().query<Person>(
    `select * from people where full_name ilike $1 order by created_at limit 1`,
    [`%${name}%`]
  );
  return res.rows[0] ?? null;
}

export interface PersonBundle {
  person: Person | null;
  interactions: Interaction[];
  commitments: Commitment[];
  meetings: Array<{ title: string; meeting_date: Date | null; summary: string | null }>;
  emails: Array<{ subject: string; summary: string | null; email_date: Date | null }>;
}

/** Everything DeanOS knows about a person, for `people` and `prep`. */
export async function getPersonBundle(name: string): Promise<PersonBundle> {
  const db = getPool();
  const person = await findPersonByName(name);
  const like = `%${name}%`;
  const [interactions, commitments, meetings, emails] = await Promise.all([
    db.query<Interaction>(
      person
        ? `select * from interactions where person_id = $1 or person_name ilike $2 order by occurred_at desc limit 20`
        : `select * from interactions where person_name ilike $2 order by occurred_at desc limit 20`,
      person ? [person.id, like] : [like]
    ),
    db.query<Commitment>(
      person
        ? `select * from commitments where person_id = $1 or person_name ilike $2 order by created_at desc limit 30`
        : `select * from commitments where person_name ilike $2 order by created_at desc limit 30`,
      person ? [person.id, like] : [like]
    ),
    db.query<{ title: string; meeting_date: Date | null; summary: string | null }>(
      `select distinct m.title, m.meeting_date, m.summary
       from meetings m join meeting_attendees a on a.meeting_id = m.id
       where a.name ilike $1 or a.email ilike $1 or m.title ilike $1
       order by m.meeting_date desc nulls last limit 10`,
      [like]
    ),
    db.query<{ subject: string; summary: string | null; email_date: Date | null }>(
      `select subject, summary, email_date from emails
       where sender ilike $1 or subject ilike $1
       order by coalesce(email_date, created_at) desc limit 10`,
      [like]
    ),
  ]);
  return {
    person,
    interactions: interactions.rows,
    commitments: commitments.rows,
    meetings: meetings.rows,
    emails: emails.rows,
  };
}

// ── Briefs ───────────────────────────────────────────────────────────────────

export interface BriefRow {
  id: string;
  generated_for: string;
  content: string;
  top3: Array<{ title: string; why: string }>;
  ignore_today: string[];
  chase: string[];
  recommendation: string | null;
  source: "manual" | "cron";
  created_at: Date;
}

export async function insertBrief(params: {
  userId: string;
  generatedFor: string; // YYYY-MM-DD
  content: string;
  top3: Array<{ title: string; why: string }>;
  ignoreToday: string[];
  chase: string[];
  recommendation: string | null;
  source: "manual" | "cron";
}): Promise<BriefRow> {
  const res = await getPool().query<BriefRow>(
    `insert into briefs (user_id, generated_for, content, top3, ignore_today, chase, recommendation, source)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     returning id, to_char(generated_for, 'YYYY-MM-DD') as generated_for, content, top3, ignore_today, chase, recommendation, source, created_at`,
    [
      params.userId,
      params.generatedFor,
      params.content,
      JSON.stringify(params.top3),
      JSON.stringify(params.ignoreToday),
      JSON.stringify(params.chase),
      params.recommendation,
      params.source,
    ]
  );
  return res.rows[0];
}

export async function getLatestBrief(): Promise<BriefRow | null> {
  const res = await getPool().query<BriefRow>(
    `select id, to_char(generated_for, 'YYYY-MM-DD') as generated_for, content, top3, ignore_today, chase, recommendation, source, created_at
     from briefs order by created_at desc limit 1`
  );
  return res.rows[0] ?? null;
}

// ── Calendar connections (OAuth) ─────────────────────────────────────────────

export interface CalendarConnection {
  id: string;
  calendar: BusinessKey;
  provider: string;
  account_email: string | null;
  access_token_enc: string;
  refresh_token_enc: string;
  expires_at: Date;
  scope: string | null;
}

export async function upsertCalendarConnection(params: {
  userId: string;
  calendar: BusinessKey;
  accountEmail: string | null;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiresAt: Date;
  scope: string | null;
}): Promise<void> {
  await getPool().query(
    `insert into calendar_connections
       (user_id, calendar, provider, account_email, access_token_enc, refresh_token_enc, expires_at, scope)
     values ($1,$2,'microsoft',$3,$4,$5,$6,$7)
     on conflict (user_id, calendar) do update set
       account_email = excluded.account_email,
       access_token_enc = excluded.access_token_enc,
       refresh_token_enc = excluded.refresh_token_enc,
       expires_at = excluded.expires_at,
       scope = excluded.scope,
       updated_at = now()`,
    [
      params.userId,
      params.calendar,
      params.accountEmail,
      params.accessTokenEnc,
      params.refreshTokenEnc,
      params.expiresAt,
      params.scope,
    ]
  );
}

export async function getCalendarConnection(
  userId: string,
  calendar: BusinessKey
): Promise<CalendarConnection | null> {
  const res = await getPool().query<CalendarConnection>(
    `select id, calendar, provider, account_email, access_token_enc, refresh_token_enc, expires_at, scope
     from calendar_connections where user_id = $1 and calendar = $2`,
    [userId, calendar]
  );
  return res.rows[0] ?? null;
}

export async function listCalendarConnections(userId: string): Promise<CalendarConnection[]> {
  const res = await getPool().query<CalendarConnection>(
    `select id, calendar, provider, account_email, access_token_enc, refresh_token_enc, expires_at, scope
     from calendar_connections where user_id = $1 order by calendar`,
    [userId]
  );
  return res.rows;
}

export async function updateCalendarTokens(params: {
  userId: string;
  calendar: BusinessKey;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiresAt: Date;
}): Promise<void> {
  await getPool().query(
    `update calendar_connections set access_token_enc=$3, refresh_token_enc=$4, expires_at=$5, updated_at=now()
     where user_id=$1 and calendar=$2`,
    [params.userId, params.calendar, params.accessTokenEnc, params.refreshTokenEnc, params.expiresAt]
  );
}

export async function deleteCalendarConnection(userId: string, calendar: BusinessKey): Promise<void> {
  await getPool().query(`delete from calendar_connections where user_id=$1 and calendar=$2`, [userId, calendar]);
}

// ── Calendar events (cache of Graph reads) ──────────────────────────────────

export interface CalendarEventRow {
  id: string;
  calendar: BusinessKey;
  source_uid: string;
  title: string;
  location: string | null;
  organizer: string | null;
  attendees: string[];
  starts_at: Date;
  ends_at: Date | null;
  all_day: boolean;
  url: string | null;
}

export async function replaceCalendarEvents(
  userId: string,
  calendar: BusinessKey,
  windowStart: Date,
  windowEnd: Date,
  events: Array<{
    sourceUid: string;
    title: string;
    location: string | null;
    organizer: string | null;
    attendees: string[];
    startsAt: Date;
    endsAt: Date | null;
    allDay: boolean;
    url: string | null;
    businessId: string | null;
  }>
): Promise<void> {
  const db = getPool();
  await db.query(
    `delete from calendar_events where user_id=$1 and calendar=$2 and starts_at >= $3 and starts_at < $4`,
    [userId, calendar, windowStart, windowEnd]
  );
  for (const e of events) {
    await db.query(
      `insert into calendar_events
         (user_id, business_id, calendar, source_uid, title, location, organizer, attendees, starts_at, ends_at, all_day, url)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (user_id, calendar, source_uid, starts_at) do update set
         title=excluded.title, location=excluded.location, organizer=excluded.organizer,
         attendees=excluded.attendees, ends_at=excluded.ends_at, all_day=excluded.all_day,
         url=excluded.url, updated_at=now()`,
      [
        userId,
        e.businessId,
        calendar,
        e.sourceUid,
        e.title,
        e.location,
        e.organizer,
        e.attendees,
        e.startsAt,
        e.endsAt,
        e.allDay,
        e.url,
      ]
    );
  }
}

export async function listCalendarEvents(
  userId: string,
  fromTs: Date,
  toTs: Date
): Promise<CalendarEventRow[]> {
  const res = await getPool().query<CalendarEventRow>(
    `select id, calendar, source_uid, title, location, organizer, attendees, starts_at, ends_at, all_day, url
     from calendar_events where user_id=$1 and starts_at >= $2 and starts_at < $3
     order by starts_at asc limit 200`,
    [userId, fromTs, toTs]
  );
  return res.rows;
}

// ── Agent find helpers (id-bearing, for edit/resolve tools) ─────────────────

export async function listActionableTasks(): Promise<
  Array<{ id: string; title: string; status: string; priority: number; due_date: string | null; business_id: string | null; todoist_task_id: string | null }>
> {
  const res = await getPool().query(
    `select id, title, status, priority,
            to_char(due_date, 'YYYY-MM-DD') as due_date, business_id, todoist_task_id
     from tasks
     where status in ('suggested','approved','sent','created')
     order by created_at desc limit 100`
  );
  return res.rows as never;
}

export async function listOpenCommitmentsWithMeta(): Promise<
  Array<{ id: string; text: string; direction: string; person_name: string | null; status: string; linked_task_id: string | null }>
> {
  const res = await getPool().query(
    `select id, text, direction, person_name, status, linked_task_id
     from commitments where status = 'open' order by created_at desc limit 100`
  );
  return res.rows as never;
}

// ── Conversation memory ──────────────────────────────────────────────────────

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export async function appendConversationMessage(params: {
  userId: string;
  channel: "telegram" | "web";
  role: "user" | "assistant";
  content: string;
}): Promise<void> {
  await getPool().query(
    `insert into conversation_messages (user_id, channel, role, content) values ($1,$2,$3,$4)`,
    [params.userId, params.channel, params.role, params.content.slice(0, 8000)]
  );
}

/** Most recent messages for a channel, oldest-first for prompting. */
export async function getRecentConversation(
  userId: string,
  channel: "telegram" | "web",
  limit = 12
): Promise<ConversationMessage[]> {
  const res = await getPool().query<ConversationMessage>(
    `select role, content from (
       select role, content, created_at from conversation_messages
       where user_id = $1 and channel = $2
       order by created_at desc limit $3
     ) recent order by created_at asc`,
    [userId, channel, limit]
  );
  return res.rows;
}

/** Keep the history bounded: delete all but the most recent `keep` per channel. */
export async function pruneConversation(
  userId: string,
  channel: "telegram" | "web",
  keep = 40
): Promise<void> {
  await getPool().query(
    `delete from conversation_messages
     where user_id = $1 and channel = $2 and id not in (
       select id from conversation_messages
       where user_id = $1 and channel = $2
       order by created_at desc limit $3
     )`,
    [userId, channel, keep]
  );
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
