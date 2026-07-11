import { createHash } from "node:crypto";
import { getEnv } from "@/lib/env";
import { callResponses, type AgentInputItem, type AgentTool } from "@/lib/ai/openai";
import { buildSnapshot } from "@/lib/assistant/state";
import { generateDailyBrief } from "@/lib/assistant/brief";
import { normalizeTitle } from "@/lib/dedup";
import {
  appendConversationMessage,
  businessByKey,
  ensureOwner,
  getOrCreatePersonByName,
  getPersonBundle,
  getRecentConversation,
  insertAiRun,
  insertCommitment,
  insertInteraction,
  insertRisk,
  insertTask,
  markTaskCreatedByDedupKey,
  pruneConversation,
  setTaskStatus,
  type Owner,
} from "@/lib/db/repo";
import { executeCreate } from "@/lib/todoist/execute";

export const AGENT_PROMPT_VERSION = "1.0.0";
const MAX_STEPS = 5;

const BUSINESS_ENUM = ["heya", "jic", "personal"] as const;

const TOOLS: AgentTool[] = [
  {
    name: "create_task",
    description:
      "Create an actionable task and send it straight to Todoist. Use when Dean asks you to do/add/remind/chase something. Title must be concise and verb-first.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title", "business", "priority", "due_date", "description"],
      properties: {
        title: { type: "string", description: "Concise, verb-first, e.g. 'Approve supplier artwork'." },
        business: { type: "string", enum: [...BUSINESS_ENUM], description: "Heya, JIC, or Personal." },
        priority: { type: "integer", minimum: 1, maximum: 4, description: "4 urgent, 3 important, 2 normal, 1 backlog." },
        due_date: { type: ["string", "null"], description: "YYYY-MM-DD, only if Dean gave an explicit date; else null." },
        description: { type: "string", description: "Short supporting context; empty string if none." },
      },
    },
  },
  {
    name: "track_waiting_on",
    description: "Record that Dean is waiting on someone for something. DeanOS flags it after 3 quiet business days.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["text", "person", "business"],
      properties: {
        text: { type: "string", description: "e.g. 'send the signed contract'." },
        person: { type: "string", description: "Who owes it." },
        business: { type: "string", enum: [...BUSINESS_ENUM] },
      },
    },
  },
  {
    name: "log_risk",
    description: "Log a material risk to track.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["description", "severity", "business"],
      properties: {
        description: { type: "string" },
        severity: { type: "string", enum: ["low", "medium", "high"] },
        business: { type: "string", enum: [...BUSINESS_ENUM] },
      },
    },
  },
  {
    name: "remember",
    description: "Store a durable note or a fact about a person (their preferences, role, context).",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["note", "person"],
      properties: {
        note: { type: "string" },
        person: { type: ["string", "null"], description: "Person the note is about, or null for a general note." },
      },
    },
  },
  {
    name: "get_person",
    description: "Look up everything DeanOS knows about a person: commitments both ways, meetings, recent email, notes. Use for questions about someone or to prep for a meeting with them.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: { name: { type: "string" } },
    },
  },
  {
    name: "get_brief",
    description: "Generate today's executive brief: Top 3 priorities, who to chase, overdue items, risks, and a recommendation. Use for 'brief', 'what should I focus on', 'how's my day'.",
    parameters: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
];

function systemPrompt(snapshotJson: string, today: string): string {
  return `You are DeanOS — Dean Ormsby's AI chief of staff, speaking with him directly over chat. Dean runs Heya (recruitment/HR services) and JIC / Just Imagine Consulting, plus a Personal context. Today is ${today}.

You are conversational, warm, and extremely concise — this is a chat, not a report. Talk like a sharp human EA: plain sentences, no markdown headers, minimal bullet points unless listing. Never dump raw data; summarise and lead with what matters.

You have a live snapshot of Dean's world below, and tools to look deeper and to act. Guidance:
- Answer directly from the snapshot when it already contains the answer (waiting-on, commitments, risks, counts, recent meetings).
- Use get_person for questions about a specific person or to prep a meeting; compose the prep yourself from what it returns (state the single most important outcome, a few talking points, a few questions).
- Use get_brief for daily-focus questions.
- Take actions when Dean clearly asks: create_task (goes straight to Todoist), track_waiting_on, log_risk, remember. Infer the business from context; if truly unclear, ask one short question instead of guessing. Never invent due dates — only set one if Dean stated it.
- After acting, confirm briefly what you did (e.g. "Added to your JIC list in Todoist.").
- Calendar isn't connected yet — if asked about schedule/availability, say so briefly.
- Never fabricate facts, people, or commitments. If you don't know, say so.

CURRENT SNAPSHOT (JSON):
${snapshotJson}`;
}

async function executeTool(
  owner: Owner,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const biz = (key: unknown) => businessByKey(owner, typeof key === "string" ? key : null);
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  switch (name) {
    case "create_task": {
      const business = biz(args.business);
      const title = str(args.title);
      if (!title) return JSON.stringify({ ok: false, error: "title required" });
      const dedupKey = createHash("sha256")
        .update(`agent:${owner.user.id}:${normalizeTitle(title)}`)
        .digest("hex");
      const { task, duplicate } = await insertTask({
        userId: owner.user.id,
        businessId: business?.id ?? null,
        meetingId: null,
        title,
        description: str(args.description) || "Captured via chat.",
        priority: typeof args.priority === "number" ? args.priority : 2,
        dueDate: typeof args.due_date === "string" ? args.due_date : null,
        labels: [],
        origin: "manual",
        confidence: null,
        sourceSystem: "assistant",
        sourceRecordId: null,
        sourceUrl: null,
        dedupKey,
        aiRunId: null,
      });
      if (duplicate || !task) return JSON.stringify({ ok: false, error: "duplicate — already captured" });
      const sent = await executeCreate(task, business);
      if (!sent.ok) {
        await setTaskStatus(task.id, "failed", sent.error);
        return JSON.stringify({ ok: false, error: `saved but Todoist failed: ${sent.error}` });
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
      return JSON.stringify({ ok: true, created: title, business: business?.name ?? "Inbox", due: args.due_date ?? null });
    }
    case "track_waiting_on": {
      const business = biz(args.business);
      const person = str(args.person);
      const text = str(args.text);
      const p = person ? await getOrCreatePersonByName(owner.user.id, person) : null;
      await insertCommitment({
        userId: owner.user.id,
        businessId: business?.id ?? null,
        meetingId: null,
        direction: "to_dean",
        text,
        personName: person || null,
        personId: p?.id ?? null,
        dateMade: new Date(),
        dueDate: null,
        confidence: null,
        linkedTaskId: null,
        sourceSystem: "assistant",
        sourceRecordId: null,
        sourceUrl: null,
        dedupKey: createHash("sha256").update(`agent-wait:${owner.user.id}:${normalizeTitle(text)}:${person}`).digest("hex"),
      });
      return JSON.stringify({ ok: true, waiting_on: `${person}: ${text}` });
    }
    case "log_risk": {
      const business = biz(args.business);
      await insertRisk({
        userId: owner.user.id,
        businessId: business?.id ?? null,
        meetingId: null,
        description: str(args.description),
        severity: (["low", "medium", "high"].includes(str(args.severity)) ? args.severity : "medium") as
          | "low"
          | "medium"
          | "high",
        confidence: null,
        sourceSystem: "assistant",
        sourceRecordId: null,
        sourceUrl: null,
      });
      return JSON.stringify({ ok: true, risk: str(args.description) });
    }
    case "remember": {
      const person = typeof args.person === "string" && args.person ? args.person : null;
      const p = person ? await getOrCreatePersonByName(owner.user.id, person) : null;
      await insertInteraction({
        userId: owner.user.id,
        personId: p?.id ?? null,
        personName: person,
        meetingId: null,
        kind: person ? "relationship_update" : "note",
        summary: str(args.note),
        occurredAt: new Date(),
        confidence: null,
        sourceSystem: "assistant",
        sourceRecordId: null,
        sourceUrl: null,
      });
      return JSON.stringify({ ok: true, remembered: str(args.note) });
    }
    case "get_person": {
      const bundle = await getPersonBundle(str(args.name));
      return JSON.stringify({
        name: bundle.person?.full_name ?? args.name,
        role: bundle.person?.role ?? null,
        organization: bundle.person?.organization ?? null,
        commitments: bundle.commitments.map((c) => ({
          direction: c.direction,
          text: c.text,
          status: c.status,
        })),
        meetings: bundle.meetings.map((m) => ({ title: m.title, summary: m.summary })),
        recent_emails: bundle.emails.map((e) => ({ subject: e.subject, summary: e.summary })),
        notes: bundle.interactions.map((i) => i.summary),
      });
    }
    case "get_brief": {
      const b = await generateDailyBrief();
      return JSON.stringify({
        top3: b.top3,
        chase: b.chase,
        ignore_today: b.ignoreToday,
        recommendation: b.recommendation,
        open_risks: b.snapshot.open_risks,
      });
    }
    default:
      return JSON.stringify({ ok: false, error: `unknown tool ${name}` });
  }
}

/**
 * Conversational agent: natural-language chat over DeanOS, with memory and
 * tools to read deeper and take actions. Used by Telegram and the web chat.
 */
export async function runAgent(
  channel: "telegram" | "web",
  userText: string
): Promise<{ reply: string }> {
  const owner = await ensureOwner();
  const model = getEnv().OPENAI_MODEL_PRIORITIZER;
  const snapshot = await buildSnapshot();
  const history = await getRecentConversation(owner.user.id, channel, 12);

  const input: AgentInputItem[] = [
    { role: "system", content: systemPrompt(JSON.stringify(snapshot), snapshot.today) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userText },
  ];

  let reply = "";
  let status: "ok" | "api_failed" = "ok";
  let lastError: string | null = null;

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await callResponses({ model, input, tools: TOOLS, maxOutputTokens: 1500 });
    if (!res.ok) {
      status = "api_failed";
      lastError = res.error;
      reply = "I hit a snag reaching my reasoning engine — try again in a moment.";
      break;
    }
    if (res.toolCalls.length === 0) {
      reply = (res.text ?? "").trim() || "…";
      break;
    }
    // Echo the tool calls, then append their outputs, and loop.
    for (const tc of res.toolCalls) {
      input.push({ type: "function_call", call_id: tc.callId, name: tc.name, arguments: tc.arguments });
    }
    for (const tc of res.toolCalls) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.arguments) as Record<string, unknown>;
      } catch {
        /* leave empty */
      }
      let output: string;
      try {
        output = await executeTool(owner, tc.name, parsedArgs);
      } catch (err) {
        output = JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      input.push({ type: "function_call_output", call_id: tc.callId, output });
    }
    if (step === MAX_STEPS - 1) {
      reply = "I did a few things but ran out of steps composing a reply — ask me to confirm what changed.";
    }
  }

  // Persist the turn (best-effort) and keep history bounded.
  await appendConversationMessage({ userId: owner.user.id, channel, role: "user", content: userText });
  await appendConversationMessage({ userId: owner.user.id, channel, role: "assistant", content: reply });
  await pruneConversation(owner.user.id, channel);
  await insertAiRun({
    userId: owner.user.id,
    promptName: "assistant-agent",
    promptVersion: AGENT_PROMPT_VERSION,
    model,
    input: { channel, userText, historyLen: history.length },
    rawOutput: reply,
    parsedOutput: null,
    status,
    error: lastError,
    usage: null,
  });

  return { reply };
}
