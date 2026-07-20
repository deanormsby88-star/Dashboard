import { getEnv } from "@/lib/env";
import { callStructured } from "@/lib/ai/openai";
import {
  PROMPT_NAME,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserMessage,
  emailProcessorJsonSchema,
  parseEmailProcessorOutput,
  type EmailProcessorInput,
} from "@/lib/ai/prompts/email-processor";
import { commitmentDedupKey, findExistingDuplicate, taskDedupKey } from "@/lib/dedup";
import {
  businessByKey,
  clearSuggestedTasksForSource,
  completeTaskByTodoistId,
  ensureOwner,
  getEmail,
  getOrCreatePerson,
  getTask,
  insertAiRun,
  insertCommitment,
  insertInteraction,
  insertRisk,
  insertTask,
  listAllTaskTitles,
  listOpenWaitingOn,
  markCommitmentDone,
  setEmailProcessing,
  setTaskStatus,
  threadHasResolvedEmail,
} from "@/lib/db/repo";
import { executeComplete } from "@/lib/todoist/execute";
import { notifyNewPerson } from "@/lib/people/notify-new";
import { MAILBOX_ADDRESSES } from "@/lib/email/schema";
import type { Person } from "@/lib/types";

/** Dean's own addresses, this email's mailbox first — lets the processor judge
 * whether an action is Dean's to perform vs. an FYI he was merely CC'd on. */
function ownerAddressesFor(mailbox: "heya" | "jic" | "personal"): string[] {
  const all = Object.keys(MAILBOX_ADDRESSES);
  const primary = all.filter((a) => MAILBOX_ADDRESSES[a] === mailbox);
  const rest = all.filter((a) => MAILBOX_ADDRESSES[a] !== mailbox);
  return [...primary, ...rest];
}

const AI_BODY_LIMIT = 6_000;

export interface EmailProcessResult {
  ok: boolean;
  error?: string;
  classification?: string;
  counts?: {
    tasks: number;
    waitingOn: number;
    risks: number;
    relationshipUpdates: number;
    resolvedWaitingOn: number;
  };
}

/**
 * Runs the Email Processor for a stored email: classification + extraction
 * with strict structured output, then persistence. Same failure policy as
 * the Meeting Processor: fail closed, keep the raw response, allow retry.
 */
export async function processEmail(emailId: string): Promise<EmailProcessResult> {
  const email = await getEmail(emailId);
  if (!email) return { ok: false, error: `Email ${emailId} not found.` };

  const owner = await ensureOwner();
  await setEmailProcessing(email.id, "processing");

  // Retry-safe: drop this email's still-suggested tasks up front, so both
  // the model's context and the dedup list reflect a clean slate for this
  // email. Rejected/created tasks are kept — they must never be re-suggested.
  await clearSuggestedTasksForSource(owner.user.id, email.message_id);

  const openWaitingOn = await listOpenWaitingOn(owner.user.id);
  const allTasks = await listAllTaskTitles(owner.user.id);
  const threadHandled = await threadHasResolvedEmail(owner.user.id, email.thread_id, email.id);
  const input: EmailProcessorInput = {
    mailbox: email.mailbox,
    direction: email.direction,
    sender: email.sender,
    recipients: email.recipients,
    subject: email.subject,
    body: email.body_text.slice(0, AI_BODY_LIMIT),
    emailDate: email.email_date ? email.email_date.toISOString() : null,
    flags: email.flags,
    openWaitingOn: openWaitingOn.map((w) => ({ id: w.id, text: w.text, person: w.person_name })),
    // Recent-first; 60 titles is plenty of context without bloating the prompt.
    recentTasks: allTasks.slice(0, 60).map((t) => ({ title: t.title, status: t.status })),
    threadAlreadyHandled: threadHandled,
    ownerAddresses: ownerAddressesFor(email.mailbox),
  };

  const model = getEnv().OPENAI_MODEL_EMAIL_PROCESSOR;
  const result = await callStructured({
    model,
    system: SYSTEM_PROMPT,
    user: buildUserMessage(input),
    schemaName: "email_classification",
    jsonSchema: emailProcessorJsonSchema,
    maxOutputTokens: 2048,
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
    await setEmailProcessing(email.id, "failed", { error });
    return { ok: false, error };
  }

  const parsed = parseEmailProcessorOutput(result.rawText);
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
    await setEmailProcessing(email.id, "failed", { error: parsed.error });
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

  const business = businessByKey(owner, email.mailbox);
  const src = {
    sourceSystem: `email:${email.mailbox}`,
    sourceRecordId: email.message_id,
    sourceUrl: email.source_url,
  };
  const emailDate = email.email_date ?? new Date(email.created_at);
  const counts = { tasks: 0, waitingOn: 0, risks: 0, relationshipUpdates: 0, resolvedWaitingOn: 0 };
  let suggestedTaskId: string | null = null;

  const newPeople = new Map<string, Person>();
  async function personIdFor(name: string): Promise<string> {
    const { person, created } = await getOrCreatePerson(owner.user.id, name);
    if (created) newPeople.set(person.id, person);
    return person.id;
  }

  const existingTitles = [...allTasks];

  // Action → one suggested task for Dean's review.
  if (output.classification === "action" && output.suggested_task) {
    const t = output.suggested_task;
    if (!findExistingDuplicate(t.title, existingTitles)) {
      const { task } = await insertTask({
        userId: owner.user.id,
        businessId: business?.id ?? null,
        meetingId: null,
        title: t.title,
        description: buildTaskNote(t.description, email),
        priority: t.priority,
        dueDate: t.due_date,
        labels: [],
        origin: "action_item",
        confidence: output.confidence,
        ...src,
        dedupKey: taskDedupKey(src.sourceSystem, email.message_id, t.title),
        aiRunId,
      });
      if (task) {
        suggestedTaskId = task.id;
        counts.tasks++;
      }
    }
  }

  // Waiting-on → to_dean commitment plus a suggested "Follow up:" task.
  if (output.classification === "waiting_on" && output.waiting_on) {
    const w = output.waiting_on;
    const followUpTitle = `Follow up: ${w.text}`;
    let linkedTaskId: string | null = null;
    if (!findExistingDuplicate(followUpTitle, existingTitles)) {
      const { task } = await insertTask({
        userId: owner.user.id,
        businessId: business?.id ?? null,
        meetingId: null,
        title: followUpTitle,
        description: buildTaskNote(`Waiting on ${w.person}.`, email),
        priority: 2,
        dueDate: null,
        labels: [],
        origin: "waiting_on",
        confidence: output.confidence,
        ...src,
        dedupKey: taskDedupKey(src.sourceSystem, email.message_id, followUpTitle),
        aiRunId,
      });
      if (task) {
        linkedTaskId = task.id;
        suggestedTaskId = task.id;
      }
    }
    const personId = await personIdFor(w.person);
    const { duplicate } = await insertCommitment({
      userId: owner.user.id,
      businessId: business?.id ?? null,
      meetingId: null,
      direction: "to_dean",
      text: w.text,
      personName: w.person,
      personId,
      dateMade: emailDate,
      dueDate: null,
      confidence: output.confidence,
      linkedTaskId,
      ...src,
      dedupKey: commitmentDedupKey(src.sourceSystem, email.message_id, "to_dean", w.text),
    });
    if (!duplicate) counts.waitingOn++;
  }

  if (output.classification === "risk" && output.risk) {
    await insertRisk({
      userId: owner.user.id,
      businessId: business?.id ?? null,
      meetingId: null,
      description: output.risk.description,
      severity: output.risk.severity,
      confidence: output.confidence,
      ...src,
    });
    counts.risks++;
  }

  if (output.classification === "relationship_update" && output.relationship_update) {
    const personId = await personIdFor(output.relationship_update.person);
    await insertInteraction({
      userId: owner.user.id,
      personId,
      personName: output.relationship_update.person,
      meetingId: null,
      kind: "relationship_update",
      summary: output.relationship_update.update,
      occurredAt: emailDate,
      confidence: output.confidence,
      ...src,
    });
    counts.relationshipUpdates++;
  }

  // Substantive replies resolve open waiting-on items. Only IDs from the
  // list we provided are honoured; the linked Todoist task is completed
  // through Zapier when that hook is configured.
  const openIds = new Map(openWaitingOn.map((w) => [w.id, w]));
  for (const id of output.resolves_waiting_on_ids) {
    const item = openIds.get(id);
    if (!item) continue;
    await markCommitmentDone(id);
    counts.resolvedWaitingOn++;
    if (item.linked_task_id) {
      const task = await getTask(item.linked_task_id);
      if (task?.status === "suggested" || task?.status === "approved") {
        await setTaskStatus(task.id, "rejected", "Resolved by email reply — follow-up no longer needed.");
      } else if (task?.status === "created" && task.todoist_task_id) {
        const sent = await executeComplete(task.todoist_task_id);
        if (sent.ok) await completeTaskByTodoistId(task.todoist_task_id);
      }
    }
  }

  await setEmailProcessing(email.id, "processed", {
    classification: output.classification,
    confidence: output.confidence,
    summary: output.summary,
    suggestedTaskId,
    // Ignore/reference emails need no further attention.
    resolved: output.classification === "ignore" || output.classification === "reference",
  });

  for (const person of newPeople.values()) {
    await notifyNewPerson(owner.user.id, person, business?.name ?? null).catch(() => {});
  }

  return { ok: true, classification: output.classification, counts };
}

function buildTaskNote(description: string, email: { subject: string; sender: string; source_url: string | null; mailbox: string }): string {
  const parts = [
    description,
    "",
    `Source: email (${email.mailbox}) — "${email.subject}" from ${email.sender}`,
  ];
  if (email.source_url) parts.push(email.source_url);
  return parts.join("\n").trim();
}
