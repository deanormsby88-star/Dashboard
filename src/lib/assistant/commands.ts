import { getEnv } from "@/lib/env";
import { callStructured, callText } from "@/lib/ai/openai";
import * as quickCapture from "@/lib/ai/prompts/quick-capture";
import * as meetingPrep from "@/lib/ai/prompts/meeting-prep";
import { buildSnapshot } from "@/lib/assistant/state";
import { runPrioritizer, formatTop3 } from "@/lib/assistant/prioritize";
import { generateDailyBrief } from "@/lib/assistant/brief";
import { businessDaysBetween, ESCALATION_BUSINESS_DAYS } from "@/lib/dates";
import { normalizeTitle } from "@/lib/dedup";
import { createHash } from "node:crypto";
import {
  businessByKey,
  ensureOwner,
  getChangesSince,
  getLastSyncRun,
  getOrCreatePersonByName,
  getPersonBundle,
  insertAiRun,
  insertCommitment,
  insertInteraction,
  insertRisk,
  insertTask,
  listCommitments,
  listRisks,
  listTasks,
  markTaskCreatedByDedupKey,
  recordSyncRun,
  setTaskStatus,
} from "@/lib/db/repo";
import { executeCreate } from "@/lib/todoist/execute";

export const COMMANDS = [
  "sync",
  "brief",
  "focus",
  "next",
  "prep",
  "waiting",
  "commitments",
  "people",
  "risks",
  "review",
  "capture",
  "remember",
  "slipping",
  "forgetting",
  "help",
] as const;

export interface AssistantReply {
  reply: string;
}

export function parseCommand(input: string): { cmd: string; args: string } {
  const trimmed = input.trim();
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
  if ((COMMANDS as readonly string[]).includes(firstWord)) {
    return { cmd: firstWord, args: trimmed.slice(firstWord.length).trim() };
  }
  return { cmd: "chat", args: trimmed };
}

export async function runCommand(input: string): Promise<AssistantReply> {
  const { cmd, args } = parseCommand(input);
  switch (cmd) {
    case "help":
      return { reply: helpText() };
    case "waiting":
      return waiting();
    case "commitments":
      return commitments();
    case "risks":
      return risks();
    case "people":
      return people(args);
    case "slipping":
      return slipping();
    case "forgetting":
      return forgetting();
    case "focus":
      return focus(false);
    case "next":
      return focus(true);
    case "brief":
      return brief();
    case "sync":
      return sync();
    case "review":
      return review();
    case "prep":
      return prep(args);
    case "capture":
      return capture(args, "capture");
    case "remember":
      return capture(args, "remember");
    default:
      return chat(args);
  }
}

function helpText(): string {
  return [
    "Commands:",
    "  sync — reconcile everything and report what changed, with a fresh Top 3",
    "  brief — executive brief for today",
    "  focus — today's Top 3 priorities",
    "  next — the single next thing to do",
    "  prep [person or meeting] — prep brief from internal context",
    "  waiting — who owes you what, with aging",
    "  commitments — both directions",
    "  people [name] — everything known about a person",
    "  risks — open risks",
    "  review — the week in review",
    "  capture [text] — turn a thought into the right record (tasks go straight to Todoist)",
    "  remember [text] — keep a fact about a person or a note",
    "  slipping — what's going stale",
    "  forgetting — what you might be forgetting",
    "",
    "Or just ask a question in plain language.",
  ].join("\n");
}

// ── Deterministic commands ───────────────────────────────────────────────────

async function waiting(): Promise<AssistantReply> {
  const all = await listCommitments("to_dean");
  const open = all.filter((c) => c.status === "open");
  if (open.length === 0) return { reply: "Nobody owes you anything right now. Enjoy it." };
  const now = new Date();
  const lines = open.map((c) => {
    const days = businessDaysBetween(new Date(c.date_made ?? c.created_at), now);
    const flag = days >= ESCALATION_BUSINESS_DAYS ? `  ⚠ ${days} business days — chase this` : `  (${days} business day${days === 1 ? "" : "s"})`;
    return `- ${c.text}${c.person_name ? ` — ${c.person_name}` : ""}${flag}`;
  });
  return { reply: `WAITING ON OTHERS (${open.length})\n\n${lines.join("\n")}` };
}

async function commitments(): Promise<AssistantReply> {
  const all = await listCommitments();
  const byDean = all.filter((c) => c.direction === "by_dean" && c.status === "open");
  const toDean = all.filter((c) => c.direction === "to_dean" && c.status === "open");
  const fmt = (list: typeof all) =>
    list.length === 0
      ? "  (none)"
      : list.map((c) => `- ${c.text}${c.person_name ? ` — ${c.person_name}` : ""}`).join("\n");
  return {
    reply: `COMMITMENTS\n\nYou promised (${byDean.length}):\n${fmt(byDean)}\n\nOwed to you (${toDean.length}):\n${fmt(toDean)}`,
  };
}

async function risks(): Promise<AssistantReply> {
  const all = (await listRisks()).filter((r) => r.status === "open");
  if (all.length === 0) return { reply: "No open risks tracked." };
  const order = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  const lines = [...all]
    .sort((a, b) => order[a.severity] - order[b.severity])
    .map((r) => `- [${r.severity.toUpperCase()}] ${r.description}`);
  return { reply: `OPEN RISKS (${all.length})\n\n${lines.join("\n")}` };
}

async function people(args: string): Promise<AssistantReply> {
  if (!args) return { reply: "Who? Try: people Lawrence" };
  const bundle = await getPersonBundle(args);
  if (!bundle.person && bundle.commitments.length === 0 && bundle.meetings.length === 0 && bundle.emails.length === 0) {
    return { reply: `Nothing on file yet for "${args}".` };
  }
  const parts: string[] = [];
  const name = bundle.person?.full_name ?? args;
  parts.push(`${name.toUpperCase()}`);
  if (bundle.person?.role || bundle.person?.organization || bundle.person?.email) {
    parts.push([bundle.person?.role, bundle.person?.organization, bundle.person?.email].filter(Boolean).join(" · "));
  }
  const openToDean = bundle.commitments.filter((c) => c.direction === "to_dean" && c.status === "open");
  const openByDean = bundle.commitments.filter((c) => c.direction === "by_dean" && c.status === "open");
  if (openToDean.length > 0)
    parts.push(`\nThey owe you:\n${openToDean.map((c) => `- ${c.text}`).join("\n")}`);
  if (openByDean.length > 0)
    parts.push(`\nYou promised them:\n${openByDean.map((c) => `- ${c.text}`).join("\n")}`);
  if (bundle.meetings.length > 0)
    parts.push(
      `\nMeetings together:\n${bundle.meetings.map((m) => `- ${m.title}${m.meeting_date ? ` (${m.meeting_date.toISOString().slice(0, 10)})` : ""}`).join("\n")}`
    );
  if (bundle.emails.length > 0)
    parts.push(`\nRecent email:\n${bundle.emails.slice(0, 5).map((e) => `- ${e.subject}`).join("\n")}`);
  if (bundle.interactions.length > 0)
    parts.push(`\nNotes:\n${bundle.interactions.slice(0, 5).map((i) => `- ${i.summary}`).join("\n")}`);
  return { reply: parts.join("\n") };
}

async function slipping(): Promise<AssistantReply> {
  const now = new Date();
  const [toDean, suggested] = await Promise.all([listCommitments("to_dean"), listTasks({ status: "suggested" })]);
  const aging = toDean
    .filter((c) => c.status === "open")
    .map((c) => ({ c, days: businessDaysBetween(new Date(c.date_made ?? c.created_at), now) }))
    .filter((x) => x.days >= ESCALATION_BUSINESS_DAYS);
  const staleSuggestions = suggested
    .map((t) => ({ t, days: businessDaysBetween(new Date(t.created_at), now) }))
    .filter((x) => x.days >= 2);
  const parts: string[] = [];
  if (aging.length > 0) {
    parts.push(
      `Going quiet on you (${ESCALATION_BUSINESS_DAYS}+ business days):\n${aging
        .map((x) => `- ${x.c.text}${x.c.person_name ? ` — ${x.c.person_name}` : ""} (${x.days} days)`)
        .join("\n")}`
    );
  }
  if (staleSuggestions.length > 0) {
    parts.push(
      `Suggested tasks sitting unreviewed:\n${staleSuggestions.map((x) => `- ${x.t.title} (${x.days} days)`).join("\n")}`
    );
  }
  if (parts.length === 0) return { reply: "Nothing is slipping. Everything open is fresh." };
  return { reply: `SLIPPING\n\n${parts.join("\n\n")}` };
}

async function forgetting(): Promise<AssistantReply> {
  const now = new Date();
  const [suggested, failed, risksAll] = await Promise.all([
    listTasks({ status: "suggested" }),
    listTasks({ status: "failed" }),
    listRisks(),
  ]);
  const oldSuggestions = suggested.filter((t) => businessDaysBetween(new Date(t.created_at), now) >= 5);
  const oldRisks = risksAll.filter(
    (r) => r.status === "open" && businessDaysBetween(new Date(r.created_at), now) >= 5
  );
  const parts: string[] = [];
  if (oldSuggestions.length > 0)
    parts.push(`Suggestions you never reviewed:\n${oldSuggestions.map((t) => `- ${t.title}`).join("\n")}`);
  if (failed.length > 0)
    parts.push(`Tasks that failed to reach Todoist:\n${failed.map((t) => `- ${t.title}`).join("\n")}`);
  if (oldRisks.length > 0)
    parts.push(`Risks with no movement:\n${oldRisks.map((r) => `- ${r.description}`).join("\n")}`);
  if (parts.length === 0) return { reply: "Nothing forgotten that I can see." };
  return { reply: `POSSIBLY FORGOTTEN\n\n${parts.join("\n\n")}` };
}

// ── AI-powered commands ──────────────────────────────────────────────────────

async function focus(single: boolean): Promise<AssistantReply> {
  const snapshot = await buildSnapshot();
  const result = await runPrioritizer(snapshot);
  if (!result.ok) return { reply: `Couldn't prioritize right now: ${result.error}` };
  const o = result.output;
  if (o.top_three.length === 0) return { reply: "Nothing needs your focus — the slate is clean." };
  if (single) {
    const t = o.top_three[0];
    return { reply: `NEXT\n\n${t.title}\n${t.why}` };
  }
  const extra: string[] = [];
  if (o.ignore_today.length > 0) extra.push(`\nIgnore today:\n${o.ignore_today.map((s) => `- ${s}`).join("\n")}`);
  if (o.recommendation) extra.push(`\n${o.recommendation}`);
  return { reply: `TOP 3\n\n${formatTop3(o)}${extra.join("")}` };
}

async function brief(): Promise<AssistantReply> {
  const b = await generateDailyBrief();
  return { reply: b.text };
}

async function sync(): Promise<AssistantReply> {
  const owner = await ensureOwner();
  const since = await getLastSyncRun("assistant-sync");
  const changes = await getChangesSince(since);
  const snapshot = await buildSnapshot();

  const escalations = snapshot.waiting_on.filter((w) => w.needs_escalation);
  const hasChanges =
    changes.tasksCreated.length > 0 ||
    changes.commitmentsOpened.length > 0 ||
    changes.commitmentsClosed.length > 0 ||
    changes.risksOpened.length > 0 ||
    changes.meetingsProcessed.length > 0 ||
    escalations.length > 0;

  await recordSyncRun({
    userId: owner.user.id,
    sourceSystem: "assistant-sync",
    stats: {
      tasksCreated: changes.tasksCreated.length,
      commitmentsOpened: changes.commitmentsOpened.length,
      commitmentsClosed: changes.commitmentsClosed.length,
      risksOpened: changes.risksOpened.length,
      meetingsProcessed: changes.meetingsProcessed.length,
    },
  });

  if (!hasChanges && snapshot.tasks_awaiting_review.length === 0) {
    return { reply: "Sync complete. No material changes." };
  }

  const result = await runPrioritizer(snapshot);
  const section = (title: string, lines: string[]) =>
    lines.length > 0 ? `\n${title}:\n${lines.map((l) => `- ${l}`).join("\n")}` : "";

  const reply = [
    "SYNC COMPLETE",
    section(
      "Created",
      [
        ...changes.tasksCreated.map((t) => `Task: ${t.title} [${t.status}]`),
        ...changes.commitmentsOpened.map(
          (c) => `${c.direction === "to_dean" ? "Waiting-on" : "Commitment"}: ${c.text}${c.person_name ? ` (${c.person_name})` : ""}`
        ),
        ...changes.risksOpened.map((r) => `Risk [${r.severity}]: ${r.description}`),
      ]
    ),
    section("Updated", changes.meetingsProcessed.map((m) => `Meeting processed: ${m.title}`)),
    section("Closed", changes.commitmentsClosed.map((c) => `${c.text}${c.person_name ? ` (${c.person_name})` : ""}`)),
    section(
      "Escalated",
      escalations.map((w) => `${w.text}${w.person ? ` — ${w.person}` : ""} (${w.business_days_waiting} business days)`)
    ),
    result.ok ? `\nTop 3:\n${formatTop3(result.output)}` : "",
    result.ok && result.output.recommendation ? `\nRecommendation:\n${result.output.recommendation}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { reply };
}

async function review(): Promise<AssistantReply> {
  const owner = await ensureOwner();
  const changes = await getChangesSince(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const snapshot = await buildSnapshot();
  const model = getEnv().OPENAI_MODEL_PRIORITIZER;
  const result = await callText({
    model,
    system:
      "You are DeanOS, the executive operating system of Dean Ormsby (Heya — recruitment/HR; JIC — Just Imagine Consulting; Personal). Write a crisp weekly review in plain text: what moved, what closed, what's stuck, what deserves attention next week. Ground every statement in the provided data; never invent. Use short sections and dashes, no markdown symbols beyond that. Maximum 250 words.",
    user: `LAST 7 DAYS (JSON):\n${JSON.stringify(changes)}\n\nCURRENT STATE (JSON):\n${JSON.stringify(snapshot)}`,
  });
  await insertAiRun({
    userId: owner.user.id,
    promptName: "assistant-review",
    promptVersion: "1.0.0",
    model,
    input: { changes, snapshot },
    rawOutput: result.rawText,
    parsedOutput: null,
    status: result.ok ? "ok" : "api_failed",
    error: result.error,
    usage: result.usage,
  });
  if (!result.ok || !result.rawText) return { reply: `Couldn't compose the review: ${result.error}` };
  return { reply: `WEEK IN REVIEW\n\n${result.rawText.trim()}` };
}

async function prep(args: string): Promise<AssistantReply> {
  if (!args) return { reply: "Prep for whom or what? Try: prep Lawrence — or: prep supplier call" };
  const owner = await ensureOwner();
  const bundle = await getPersonBundle(args);
  const context = {
    person: bundle.person
      ? { name: bundle.person.full_name, role: bundle.person.role, organization: bundle.person.organization }
      : null,
    previous_meetings: bundle.meetings.map((m) => ({
      title: m.title,
      date: m.meeting_date ? m.meeting_date.toISOString().slice(0, 10) : null,
      summary: m.summary,
    })),
    commitments_by_dean: bundle.commitments
      .filter((c) => c.direction === "by_dean" && c.status === "open")
      .map((c) => c.text),
    waiting_on_them: bundle.commitments
      .filter((c) => c.direction === "to_dean" && c.status === "open")
      .map((c) => c.text),
    recent_emails: bundle.emails.map((e) => ({ subject: e.subject, summary: e.summary })),
    notes: bundle.interactions.map((i) => i.summary),
  };
  const model = getEnv().OPENAI_MODEL_PRIORITIZER;
  const result = await callStructured({
    model,
    system: meetingPrep.SYSTEM_PROMPT,
    user: meetingPrep.buildUserMessage(args, JSON.stringify(context)),
    schemaName: "meeting_prep",
    jsonSchema: meetingPrep.meetingPrepJsonSchema,
    maxOutputTokens: 2048,
  });
  const parsed = result.ok && result.rawText !== null ? meetingPrep.parseMeetingPrepOutput(result.rawText) : null;
  await insertAiRun({
    userId: owner.user.id,
    promptName: meetingPrep.PROMPT_NAME,
    promptVersion: meetingPrep.PROMPT_VERSION,
    model,
    input: { subject: args, context },
    rawOutput: result.rawText,
    parsedOutput: parsed?.ok ? parsed.output : null,
    status: !result.ok ? "api_failed" : parsed?.ok ? "ok" : "parse_failed",
    error: !result.ok ? result.error : parsed?.ok ? null : (parsed?.error ?? "unknown"),
    usage: result.usage,
  });
  if (!result.ok || !parsed?.ok) {
    return { reply: `Couldn't build the prep brief: ${!result.ok ? result.error : parsed && !parsed.ok ? parsed.error : "unknown error"}` };
  }
  const o = parsed.output;
  // The model sometimes echoes the framing sentence; don't print it twice.
  const objective = o.objective.replace(/^the single most important outcome for this meeting is:?\s*/i, "");
  return {
    reply: [
      `PREP — ${args}`,
      "",
      `The single most important outcome for this meeting is:\n${objective}`,
      "",
      o.context_summary,
      o.talking_points.length > 0 ? `\nTalking points:\n${o.talking_points.map((t) => `- ${t}`).join("\n")}` : "",
      o.questions.length > 0 ? `\nQuestions to ask:\n${o.questions.map((q) => `- ${q}`).join("\n")}` : "",
      "\n(Public research arrives in Phase 3 — this brief uses internal context only.)",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

async function capture(args: string, mode: "capture" | "remember"): Promise<AssistantReply> {
  if (!args) return { reply: mode === "capture" ? "Capture what? Try: capture Chase printer quote by Friday" : "Remember what?" };
  const owner = await ensureOwner();
  const model = getEnv().OPENAI_MODEL_PRIORITIZER;
  const today = new Date().toISOString().slice(0, 10);
  const result = await callStructured({
    model,
    system: quickCapture.SYSTEM_PROMPT,
    user: quickCapture.buildUserMessage(args, today, mode === "remember" ? "remember" : undefined),
    schemaName: "quick_capture",
    jsonSchema: quickCapture.quickCaptureJsonSchema,
    maxOutputTokens: 1024,
  });
  const parsed = result.ok && result.rawText !== null ? quickCapture.parseQuickCaptureOutput(result.rawText) : null;
  await insertAiRun({
    userId: owner.user.id,
    promptName: quickCapture.PROMPT_NAME,
    promptVersion: quickCapture.PROMPT_VERSION,
    model,
    input: { text: args, mode },
    rawOutput: result.rawText,
    parsedOutput: parsed?.ok ? parsed.output : null,
    status: !result.ok ? "api_failed" : parsed?.ok ? "ok" : "parse_failed",
    error: !result.ok ? result.error : parsed?.ok ? null : (parsed?.error ?? "unknown"),
    usage: result.usage,
  });
  if (!result.ok || !parsed?.ok) {
    return { reply: `Couldn't parse that: ${!result.ok ? result.error : parsed && !parsed.ok ? parsed.error : "unknown error"}` };
  }
  const o = parsed.output;
  const business = businessByKey(owner, o.business === "unknown" ? null : o.business);
  const dedupKey = createHash("sha256")
    .update(`capture:${today}:${normalizeTitle(args)}`)
    .digest("hex");

  if (o.kind === "task" && o.task) {
    const { task, duplicate } = await insertTask({
      userId: owner.user.id,
      businessId: business?.id ?? null,
      meetingId: null,
      title: o.task.title,
      description: o.task.description || `Captured via Assistant: "${args}"`,
      priority: o.task.priority,
      dueDate: o.task.due_date,
      labels: [],
      origin: "manual",
      confidence: null,
      sourceSystem: "assistant",
      sourceRecordId: null,
      sourceUrl: null,
      dedupKey,
      aiRunId: null,
    });
    if (duplicate || !task) return { reply: "You already captured that one." };
    const sent = await executeCreate(task, business);
    if (!sent.ok) {
      await setTaskStatus(task.id, "failed", sent.error);
      return { reply: `Saved the task but couldn't reach Todoist: ${sent.error}. It's under Tasks → Failed for retry.` };
    }
    if (sent.created) {
      await markTaskCreatedByDedupKey({
        taskId: task.id,
        todoistTaskId: sent.created.todoistTaskId,
        todoistTaskUrl: sent.created.todoistTaskUrl,
      });
    } else {
      await setTaskStatus(task.id, "sent");
    }
    return {
      reply: `Task created in Todoist (${business?.name ?? "Inbox"}):\n- ${o.task.title}${o.task.due_date ? ` (due ${o.task.due_date})` : ""} [P${o.task.priority}]`,
    };
  }

  if (o.kind === "waiting_on" && o.waiting_on) {
    const person = await getOrCreatePersonByName(owner.user.id, o.waiting_on.person);
    await insertCommitment({
      userId: owner.user.id,
      businessId: business?.id ?? null,
      meetingId: null,
      direction: "to_dean",
      text: o.waiting_on.text,
      personName: o.waiting_on.person,
      personId: person.id,
      dateMade: new Date(),
      dueDate: null,
      confidence: null,
      linkedTaskId: null,
      sourceSystem: "assistant",
      sourceRecordId: null,
      sourceUrl: null,
      dedupKey,
    });
    return { reply: `Tracking it: waiting on ${o.waiting_on.person} — ${o.waiting_on.text}. I'll flag it after ${ESCALATION_BUSINESS_DAYS} quiet business days.` };
  }

  if (o.kind === "risk" && o.risk) {
    await insertRisk({
      userId: owner.user.id,
      businessId: business?.id ?? null,
      meetingId: null,
      description: o.risk.description,
      severity: o.risk.severity,
      confidence: null,
      sourceSystem: "assistant",
      sourceRecordId: null,
      sourceUrl: null,
    });
    return { reply: `Risk logged [${o.risk.severity}]: ${o.risk.description}` };
  }

  if (o.kind === "relationship_update" && o.relationship_update) {
    const person = await getOrCreatePersonByName(owner.user.id, o.relationship_update.person);
    await insertInteraction({
      userId: owner.user.id,
      personId: person.id,
      personName: o.relationship_update.person,
      meetingId: null,
      kind: "relationship_update",
      summary: o.relationship_update.update,
      occurredAt: new Date(),
      confidence: null,
      sourceSystem: "assistant",
      sourceRecordId: null,
      sourceUrl: null,
    });
    return { reply: `Noted about ${o.relationship_update.person}: ${o.relationship_update.update}` };
  }

  await insertInteraction({
    userId: owner.user.id,
    personId: null,
    personName: null,
    meetingId: null,
    kind: "note",
    summary: o.note ?? args,
    occurredAt: new Date(),
    confidence: null,
    sourceSystem: "assistant",
    sourceRecordId: null,
    sourceUrl: null,
  });
  return { reply: `Noted: ${o.note ?? args}` };
}

async function chat(question: string): Promise<AssistantReply> {
  if (!question) return { reply: helpText() };
  const owner = await ensureOwner();
  const snapshot = await buildSnapshot();
  const model = getEnv().OPENAI_MODEL_PRIORITIZER;
  const result = await callText({
    model,
    system:
      "You are DeanOS, Dean Ormsby's AI chief of staff (Heya — recruitment/HR; JIC — Just Imagine Consulting; Personal). Answer his question directly and briefly using ONLY the state snapshot provided. If the snapshot doesn't contain the answer, say what you don't have rather than guessing. Calendar data isn't connected yet (Phase 3) — say so if asked about schedule. Plain text, short lines, no markdown headers.",
    user: `STATE SNAPSHOT (JSON):\n${JSON.stringify(snapshot)}\n\nDEAN ASKS: ${question}`,
  });
  await insertAiRun({
    userId: owner.user.id,
    promptName: "assistant-chat",
    promptVersion: "1.0.0",
    model,
    input: { question },
    rawOutput: result.rawText,
    parsedOutput: null,
    status: result.ok ? "ok" : "api_failed",
    error: result.error,
    usage: result.usage,
  });
  if (!result.ok || !result.rawText) return { reply: `I hit a snag answering that: ${result.error}` };
  return { reply: result.rawText.trim() };
}
