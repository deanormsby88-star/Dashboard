import { getEnv } from "@/lib/env";
import { callStructured } from "@/lib/ai/openai";
import {
  PROMPT_NAME,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserMessage,
  meetingProcessorJsonSchema,
  parseMeetingProcessorOutput,
  type MeetingProcessorInput,
} from "@/lib/ai/prompts/meeting-processor";
import {
  commitmentDedupKey,
  findExistingDuplicate,
  isDuplicateTitle,
  mergeExtractedTasks,
  taskDedupKey,
} from "@/lib/dedup";
import {
  businessByKey,
  clearSuggestedExtractions,
  ensureOwner,
  getMeeting,
  getMeetingAttendees,
  getOrCreatePerson,
  insertAiRun,
  insertCommitment,
  insertDecision,
  insertInteraction,
  insertRisk,
  insertTask,
  listAllTaskTitles,
  setMeetingProcessing,
} from "@/lib/db/repo";
import { notifyNewPerson } from "@/lib/people/notify-new";
import type { Person } from "@/lib/types";

export interface ProcessResult {
  ok: boolean;
  error?: string;
  counts?: {
    tasks: number;
    tasksSkippedAsDuplicates: number;
    commitments: number;
    waitingOn: number;
    decisions: number;
    risks: number;
    relationshipUpdates: number;
  };
}

/**
 * Runs the Meeting Processor for a stored meeting: OpenAI extraction with
 * strict structured output, Zod validation, deduplication, persistence.
 *
 * Failure policy per the brief: store the raw response in ai_runs, mark the
 * meeting failed, execute nothing downstream, allow retry. Reprocessing
 * clears prior *suggested* extractions first, so retries never double-insert.
 */
export async function processMeeting(meetingId: string): Promise<ProcessResult> {
  const meeting = await getMeeting(meetingId);
  if (!meeting) return { ok: false, error: `Meeting ${meetingId} not found.` };

  const owner = await ensureOwner();
  await setMeetingProcessing(meeting.id, "processing");

  const attendees = await getMeetingAttendees(meeting.id);
  const payload = await getMeetingActionItems(meeting.user_id, meeting.source_system, meeting.source_record_id);

  const input: MeetingProcessorInput = {
    meetingId: meeting.source_record_id,
    title: meeting.title,
    meetingDate: meeting.meeting_date ? meeting.meeting_date.toISOString().slice(0, 10) : null,
    attendees: attendees
      .map((a) => a.name ?? a.email)
      .filter((v): v is string => Boolean(v)),
    notes: meeting.notes,
    transcript: meeting.transcript,
    actionItems: payload,
    sourceUrl: meeting.source_url,
  };

  const model = getEnv().OPENAI_MODEL_MEETING_PROCESSOR;
  const result = await callStructured({
    model,
    system: SYSTEM_PROMPT,
    user: buildUserMessage(input),
    schemaName: "meeting_extraction",
    jsonSchema: meetingProcessorJsonSchema,
    maxOutputTokens: 8192,
  });

  if (!result.ok || result.rawText === null) {
    const error = result.error ?? "Empty model response.";
    await insertAiRun({
      userId: owner.user.id,
      promptName: PROMPT_NAME,
      promptVersion: PROMPT_VERSION,
      model,
      input,
      rawOutput: result.rawText,
      parsedOutput: null,
      status: "api_failed",
      error,
      usage: result.usage,
    });
    await setMeetingProcessing(meeting.id, "failed", { error });
    return { ok: false, error };
  }

  const parsed = parseMeetingProcessorOutput(result.rawText);
  if (!parsed.ok) {
    await insertAiRun({
      userId: owner.user.id,
      promptName: PROMPT_NAME,
      promptVersion: PROMPT_VERSION,
      model,
      input,
      rawOutput: result.rawText,
      parsedOutput: null,
      status: "parse_failed",
      error: parsed.error,
      usage: result.usage,
    });
    await setMeetingProcessing(meeting.id, "failed", { error: parsed.error });
    return { ok: false, error: parsed.error };
  }

  const output = parsed.output;
  const aiRunId = await insertAiRun({
    userId: owner.user.id,
    promptName: PROMPT_NAME,
    promptVersion: PROMPT_VERSION,
    model,
    input,
    rawOutput: result.rawText,
    parsedOutput: output,
    status: "ok",
    error: null,
    usage: result.usage,
  });

  // Retry-safe: drop anything previously suggested from this meeting.
  await clearSuggestedExtractions(meeting.id);

  const business = businessByKey(owner, output.business);
  const src = {
    sourceSystem: meeting.source_system,
    sourceRecordId: meeting.source_record_id,
    sourceUrl: meeting.source_url,
  };
  const counts = {
    tasks: 0,
    tasksSkippedAsDuplicates: 0,
    commitments: 0,
    waitingOn: 0,
    decisions: 0,
    risks: 0,
    relationshipUpdates: 0,
  };

  // Tasks: merge intra-extraction duplicates, then dedup against live tasks.
  const existingTitles = await listAllTaskTitles(owner.user.id);
  const mergedTasks = mergeExtractedTasks(
    output.tasks.map((t) => ({ ...t, confidence: t.confidence as number | null }))
  );

  const insertedTaskIds = new Map<string, string>(); // normalized use: title -> task id
  for (const task of mergedTasks) {
    const duplicate = findExistingDuplicate(task.title, existingTitles);
    if (duplicate) {
      counts.tasksSkippedAsDuplicates++;
      continue;
    }
    const { task: inserted, duplicate: keyCollision } = await insertTask({
      userId: owner.user.id,
      businessId: business?.id ?? null,
      meetingId: meeting.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueDate: task.due_date,
      labels: task.labels,
      origin: task.origin,
      confidence: task.confidence,
      ...src,
      dedupKey: taskDedupKey(meeting.source_system, meeting.source_record_id, task.title),
      aiRunId,
    });
    if (keyCollision || !inserted) {
      counts.tasksSkippedAsDuplicates++;
      continue;
    }
    counts.tasks++;
    existingTitles.push({ id: inserted.id, title: inserted.title, status: inserted.status });
    insertedTaskIds.set(inserted.title, inserted.id);
  }

  const meetingDate = meeting.meeting_date ?? new Date(meeting.created_at);

  // Track newly-discovered people so Dean gets one bio prompt each afterwards.
  const newPeople = new Map<string, Person>();
  async function personIdFor(name: string): Promise<string> {
    const { person, created } = await getOrCreatePerson(owner.user.id, name);
    if (created) newPeople.set(person.id, person);
    return person.id;
  }

  // Commitments Dean made — linked to the matching task when one was created.
  for (const c of output.commitments_by_dean) {
    const linkedTask =
      [...insertedTaskIds.entries()].find(([title]) => isDuplicateTitle(title, c.text)) ?? null;
    const { duplicate } = await insertCommitment({
      userId: owner.user.id,
      businessId: business?.id ?? null,
      meetingId: meeting.id,
      direction: "by_dean",
      text: c.text,
      personName: c.person,
      personId: c.person ? await personIdFor(c.person) : null,
      dateMade: meetingDate,
      dueDate: c.due_date,
      confidence: c.confidence,
      linkedTaskId: linkedTask ? linkedTask[1] : null,
      ...src,
      dedupKey: commitmentDedupKey(meeting.source_system, meeting.source_record_id, "by_dean", c.text),
    });
    if (!duplicate) counts.commitments++;
  }

  // Waiting-on items: a to_dean commitment plus a suggested "Follow up:" task.
  for (const w of output.waiting_on) {
    const followUpTitle = `Follow up: ${w.text}`;
    let linkedTaskId: string | null = null;
    if (!findExistingDuplicate(followUpTitle, existingTitles)) {
      const { task: inserted } = await insertTask({
        userId: owner.user.id,
        businessId: business?.id ?? null,
        meetingId: meeting.id,
        title: followUpTitle,
        description: `Waiting on ${w.person} — from meeting "${meeting.title}".`,
        priority: 2,
        dueDate: null,
        labels: [],
        origin: "waiting_on",
        confidence: w.confidence,
        ...src,
        dedupKey: taskDedupKey(meeting.source_system, meeting.source_record_id, followUpTitle),
        aiRunId,
      });
      if (inserted) {
        linkedTaskId = inserted.id;
        existingTitles.push({ id: inserted.id, title: inserted.title, status: inserted.status });
      }
    }
    const personId = await personIdFor(w.person);
    const { duplicate } = await insertCommitment({
      userId: owner.user.id,
      businessId: business?.id ?? null,
      meetingId: meeting.id,
      direction: "to_dean",
      text: w.text,
      personName: w.person,
      personId,
      dateMade: meetingDate,
      dueDate: null,
      confidence: w.confidence,
      linkedTaskId,
      ...src,
      dedupKey: commitmentDedupKey(meeting.source_system, meeting.source_record_id, "to_dean", w.text),
    });
    if (!duplicate) counts.waitingOn++;
  }

  for (const d of output.decisions) {
    await insertDecision({
      userId: owner.user.id,
      businessId: business?.id ?? null,
      meetingId: meeting.id,
      text: d.text,
      decidedOn: meetingDate,
      confidence: d.confidence,
      ...src,
    });
    counts.decisions++;
  }

  for (const r of output.risks) {
    await insertRisk({
      userId: owner.user.id,
      businessId: business?.id ?? null,
      meetingId: meeting.id,
      description: r.description,
      severity: r.severity,
      confidence: r.confidence,
      ...src,
    });
    counts.risks++;
  }

  for (const u of output.relationship_updates) {
    const personId = await personIdFor(u.person);
    await insertInteraction({
      userId: owner.user.id,
      personId,
      personName: u.person,
      meetingId: meeting.id,
      kind: "relationship_update",
      summary: u.update,
      occurredAt: meetingDate,
      confidence: u.confidence,
      ...src,
    });
    counts.relationshipUpdates++;
  }

  await setMeetingProcessing(meeting.id, "processed", {
    businessId: business?.id ?? null,
    summary: output.summary,
    recommendedFollowUp: output.recommended_follow_up,
  });

  // Ask Dean for a bio on each newly-discovered contact (best-effort).
  for (const person of newPeople.values()) {
    await notifyNewPerson(owner.user.id, person, business?.name ?? null).catch(() => {});
  }

  return { ok: true, counts };
}

/** Formal action items live in the raw source payload, not on the meeting row. */
async function getMeetingActionItems(
  userId: string,
  sourceSystem: string,
  sourceRecordId: string
): Promise<string[]> {
  const { getSourceRecordPayload } = await import("@/lib/db/repo");
  const payload = await getSourceRecordPayload(userId, sourceSystem, sourceRecordId);
  if (payload && typeof payload === "object") {
    const { normalizeCirclebackPayload } = await import("@/lib/circleback/schema");
    const normalized = normalizeCirclebackPayload(payload);
    if (normalized.ok && normalized.payload) return normalized.payload.actionItems;
  }
  return [];
}
