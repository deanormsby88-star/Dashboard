import { createHash } from "node:crypto";
import { getEnv } from "@/lib/env";
import { callResponses, type AgentInputItem, type AgentTool } from "@/lib/ai/openai";
import { buildSnapshot } from "@/lib/assistant/state";
import { generateDailyBrief } from "@/lib/assistant/brief";
import { cancelReminder, createReminder, listUpcomingReminders } from "@/lib/assistant/adhoc-reminders";
import { normalizeTitle } from "@/lib/dedup";
import { DEAN_VOICE } from "@/lib/voice";
import { research } from "@/lib/research";
import { wazeLink } from "@/lib/maps";
import { draftReply, mailtoLink, senderAddress } from "@/lib/email/draft";
import { withHeyaSignature } from "@/lib/email/signature";
import { getUpcoming, syncCalendar } from "@/lib/calendar/sync";
import {
  createEvent,
  deleteEvent,
  getMessageBody,
  getValidAccessToken,
  replyToMessage,
  searchMessages,
  sendNewMessage,
  updateEvent,
  type GraphMessage,
} from "@/lib/calendar/microsoft";
import { listCalendarConnections } from "@/lib/db/repo";
import {
  appendConversationMessage,
  businessByKey,
  completeTaskByTodoistId,
  deletePerson,
  ensureOwner,
  getCommitment,
  findPersonByName,
  getOrCreatePersonByName,
  getEmail,
  getPersonBundle,
  getRecentConversation,
  getRisk,
  getTask,
  listEmails,
  insertAiRun,
  insertCommitment,
  insertInteraction,
  insertRisk,
  insertTask,
  listActionableTasks,
  listOpenCommitmentsWithMeta,
  listRisks,
  markTaskCreatedByDedupKey,
  pruneConversation,
  setTaskStatus,
  updateCommitment,
  updatePerson,
  updateRisk,
  updateTaskFields,
  type Owner,
} from "@/lib/db/repo";
import { executeComplete, executeCreate, executeUpdate } from "@/lib/todoist/execute";

export const AGENT_PROMPT_VERSION = "1.8.0";
const MAX_STEPS = 8;

/** Format an absolute instant in Dean's local time (SAST) for the model to read out. */
function formatLocal(d: Date): string {
  return new Date(d).toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

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
    name: "update_person",
    description:
      "Save profile details / a bio for a person (role, company, email, phone, notes worth remembering). Use when Dean gives you facts about someone — e.g. after you asked about a newly-discovered contact.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["name", "role", "organization", "email", "phone", "notes"],
      properties: {
        name: { type: "string", description: "The person's name as DeanOS knows them." },
        role: { type: ["string", "null"] },
        organization: { type: ["string", "null"] },
        email: { type: ["string", "null"] },
        phone: { type: ["string", "null"] },
        notes: { type: ["string", "null"], description: "Free-text bio / anything worth remembering." },
      },
    },
  },
  {
    name: "remove_person",
    description:
      "Delete a person from Dean's people list (e.g. he says someone is unimportant / not a real contact). Their past commitments and history are kept. Confirm with Dean before removing if there's any doubt.",
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
  {
    name: "get_calendar",
    description:
      "List Dean's calendar events (Outlook Heya + JIC) for the next N days. Use for 'what's on today', 'what's my week', 'am I free Thursday', 'when's my next meeting'. Returns events with ids for rescheduling/cancelling.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["days"],
      properties: { days: { type: "integer", minimum: 1, maximum: 21, description: "How many days ahead to include (1 = today only)." } },
    },
  },
  {
    name: "create_event",
    description:
      "Book a new calendar event. Times MUST be UTC ISO 8601. Convert the local time Dean says using his timezone (given in context) before calling.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["calendar", "title", "start_utc", "end_utc", "attendees", "location"],
      properties: {
        calendar: { type: "string", enum: ["heya", "jic"], description: "Which Outlook calendar." },
        title: { type: "string" },
        start_utc: { type: "string", description: "Start, UTC ISO e.g. 2026-07-15T13:00:00Z." },
        end_utc: { type: "string", description: "End, UTC ISO. Default 30 min after start if unsure." },
        attendees: { type: "array", items: { type: "string" }, description: "Attendee email addresses; empty array if none." },
        location: { type: ["string", "null"] },
      },
    },
  },
  {
    name: "reschedule_event",
    description: "Move an existing event to a new time. Get calendar + event_id from get_calendar first. Times UTC ISO.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["calendar", "event_id", "start_utc", "end_utc"],
      properties: {
        calendar: { type: "string", enum: ["heya", "jic"] },
        event_id: { type: "string" },
        start_utc: { type: "string" },
        end_utc: { type: "string" },
      },
    },
  },
  {
    name: "cancel_event",
    description: "Cancel/delete an event. Get calendar + event_id from get_calendar first.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["calendar", "event_id"],
      properties: {
        calendar: { type: "string", enum: ["heya", "jic"] },
        event_id: { type: "string" },
      },
    },
  },
  {
    name: "set_reminder",
    description:
      "Schedule a one-off reminder that DeanOS will send Dean as a Telegram message at a specific time. Use whenever Dean says 'remind me to… at/​in…'. Convert his local SAST time to UTC ISO for remind_at_utc (e.g. '3pm today' → todayT13:00:00Z; 'in 30 minutes' → now + 30 min in UTC).",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["text", "remind_at_utc"],
      properties: {
        text: { type: "string", description: "What to remind him about, phrased as the reminder itself (e.g. 'call the plumber')." },
        remind_at_utc: { type: "string", description: "When to send it, UTC ISO 8601, e.g. 2026-07-13T13:00:00Z. Must be in the future." },
      },
    },
  },
  {
    name: "list_reminders",
    description: "List Dean's upcoming one-off reminders (not yet sent) with their ids, so you can tell him what's scheduled or cancel one.",
    parameters: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  {
    name: "cancel_reminder",
    description: "Cancel a scheduled one-off reminder so it won't be sent. Get the id from list_reminders first.",
    parameters: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "find_emails",
    description:
      "List Dean's recent unhandled emails (needing a reply or action) with ids, sender, subject and a one-line summary. Call this before drafting a reply, or when Dean asks what's in his inbox / what needs a response.",
    parameters: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  {
    name: "draft_email_reply",
    description:
      "Draft a reply to a specific email in Dean's voice. Returns the draft plus a one-tap send link (opens his mail app pre-filled). Get the email_id from find_emails first. Offer this whenever Dean mentions an email that needs a response.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["email_id", "guidance"],
      properties: {
        email_id: { type: "string" },
        guidance: {
          type: ["string", "null"],
          description: "Dean's steer for the reply (e.g. 'accept but move to next week'), or null to reply on the merits.",
        },
      },
    },
  },
  {
    name: "search_email",
    description:
      "Search Dean's actual Outlook mail directly (Heya and/or JIC) — the live inbox, full history. Use for ANY question about his email ('what did Lisa send about X', 'anything from ylazarus this week', 'check my Heya inbox'). Returns messages with ids for reading or replying.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["mailbox", "query", "days"],
      properties: {
        mailbox: { type: "string", enum: ["heya", "jic", "both"], description: "Which mailbox. Default 'both' if unclear." },
        query: { type: ["string", "null"], description: "Free-text search over subject/body/sender. Null lists most recent mail." },
        days: { type: ["integer", "null"], description: "Only mail newer than this many days (used when query is null). Null = no date limit." },
      },
    },
  },
  {
    name: "read_email",
    description: "Read the full body of one email. Get mailbox + message_id from search_email first.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["mailbox", "message_id"],
      properties: {
        mailbox: { type: "string", enum: ["heya", "jic"] },
        message_id: { type: "string" },
      },
    },
  },
  {
    name: "send_email_reply",
    description:
      "Send a threaded reply to an email from Dean's Outlook. ONLY call after Dean has seen the draft and explicitly approved sending. Get mailbox + message_id from search_email.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["mailbox", "message_id", "body"],
      properties: {
        mailbox: { type: "string", enum: ["heya", "jic"] },
        message_id: { type: "string" },
        body: { type: "string", description: "The reply body, in Dean's voice, signed off as Dean." },
      },
    },
  },
  {
    name: "send_email",
    description:
      "Send a brand-new email from Dean's Outlook. ONLY call after Dean has seen the draft and explicitly approved sending.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["mailbox", "to", "subject", "body"],
      properties: {
        mailbox: { type: "string", enum: ["heya", "jic"] },
        to: { type: "array", items: { type: "string" }, description: "Recipient email addresses." },
        subject: { type: "string" },
        body: { type: "string", description: "The email body, in Dean's voice, signed off as Dean." },
      },
    },
  },
  {
    name: "web_research",
    description:
      "Search the public web for current information about a person, company, topic, or news. Use for 'what's the latest on…', 'who is…', 'look up…', or to prep with public context. Pass ONLY public identifiers — never Dean's internal/confidential details.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: { query: { type: "string", description: "A public search query, e.g. 'Anchor Offices Cape Town recent news'." } },
    },
  },
  {
    name: "find_tasks",
    description:
      "List Dean's current tasks (suggested/approved/sent/created) with their ids, so you can then edit, complete, approve or reject a specific one. Call this before any task action to get the right id.",
    parameters: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  {
    name: "update_task",
    description: "Change a task's title, priority, due date, or business. If it's already in Todoist, the change is pushed there too. Get the id from find_tasks first.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["id", "title", "priority", "due_date", "business"],
      properties: {
        id: { type: "string" },
        title: { type: ["string", "null"], description: "New title, or null to leave unchanged." },
        priority: { type: ["integer", "null"], minimum: 1, maximum: 4, description: "New priority, or null." },
        due_date: { type: ["string", "null"], description: "YYYY-MM-DD, or null to leave unchanged. To clear a date, pass the string 'none'." },
        business: { type: ["string", "null"], enum: [...BUSINESS_ENUM, null], description: "New business, or null." },
      },
    },
  },
  {
    name: "complete_task",
    description: "Mark a task done (and complete it in Todoist if it's there). Get the id from find_tasks.",
    parameters: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "approve_task",
    description: "Approve a still-suggested task, sending it to Todoist. Get the id from find_tasks.",
    parameters: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "reject_task",
    description: "Dismiss/reject a suggested task Dean doesn't want. Get the id from find_tasks.",
    parameters: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "find_commitments",
    description: "List open commitments (both 'you promised' = by_dean and 'waiting on others' = to_dean) with ids, so you can resolve or edit one.",
    parameters: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  {
    name: "resolve_commitment",
    description: "Set a commitment's status: 'done' (fulfilled), 'cancelled' (no longer needed), or 'open' (reopen). Resolving also tidies its linked follow-up task. Get the id from find_commitments.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["id", "status"],
      properties: {
        id: { type: "string" },
        status: { type: "string", enum: ["done", "cancelled", "open"] },
      },
    },
  },
  {
    name: "update_commitment",
    description: "Edit a commitment's text or person. Get the id from find_commitments.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["id", "text", "person"],
      properties: {
        id: { type: "string" },
        text: { type: ["string", "null"] },
        person: { type: ["string", "null"] },
      },
    },
  },
  {
    name: "find_risks",
    description: "List open risks with ids, so you can mitigate, close, or edit one.",
    parameters: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  {
    name: "update_risk",
    description: "Change a risk's status ('mitigated'/'closed'/'open'), severity, or description. Get the id from find_risks.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["id", "status", "severity", "description"],
      properties: {
        id: { type: "string" },
        status: { type: ["string", "null"], enum: ["open", "mitigated", "closed", null] },
        severity: { type: ["string", "null"], enum: ["low", "medium", "high", null] },
        description: { type: ["string", "null"] },
      },
    },
  },
];

function systemPrompt(snapshotJson: string, today: string, nowLocal: string, connectedCalendars: string): string {
  return `You are DeanOS — Dean Ormsby's AI chief of staff, speaking with him directly over chat. Dean runs Heya (recruitment/HR services) and JIC / Just Imagine Consulting, plus a Personal context. Today is ${today}. Current local time: ${nowLocal}. Dean's timezone is Africa/Johannesburg (UTC+2, no daylight saving).

Connected calendars: ${connectedCalendars}. For ANY question about his diary, schedule, meetings, or availability, you MUST call get_calendar and answer from what it returns — never answer from memory and never say the calendar isn't connected when calendars are listed here.

You are conversational, warm, and extremely concise — this is a chat, not a report. Talk like a sharp human EA: plain sentences, no markdown headers, minimal bullet points unless listing. Never dump raw data; summarise and lead with what matters.

You have a live snapshot of Dean's world below, and tools to look deeper and to act. Guidance:
- Answer directly from the snapshot when it already contains the answer (waiting-on, commitments, risks, counts, recent meetings).
- Use get_person for questions about a specific person or to prep a meeting; compose the prep yourself from what it returns (state the single most important outcome, a few talking points, a few questions). For meeting prep, if internal context is thin or Dean wants background, also call web_research for public context — keep public findings clearly labelled as such, separate from internal facts.
- Use web_research to look up public information (people, companies, news). Only ever pass public identifiers to it, never Dean's internal or confidential details.
- Use get_brief when Dean asks for his brief / "how's my day" — it returns the fully-formatted brief (date, weather, calendar, tasks); send it back essentially verbatim, don't reformat it.
- Take actions when Dean clearly asks. You can create AND manage things:
  • Tasks: create_task, and to change/finish existing ones first call find_tasks to get the id, then update_task / complete_task / approve_task / reject_task. Changes to tasks already in Todoist are pushed there automatically.
  • Commitments: track_waiting_on to add; find_commitments then resolve_commitment (done/cancelled/reopen) or update_commitment to manage. Resolving a waiting-on also closes its follow-up task.
  • Risks: log_risk to add; find_risks then update_risk to mitigate/close/edit.
  • People: update_person to save a bio/details (role, company, email, phone, notes). When you've just asked Dean about a new contact and he replies with details, call update_person for that person. remove_person to delete someone Dean says is unimportant / not a real contact (their history is kept).
  • Calendar (Outlook Heya + JIC): get_calendar to view; create_event to book; reschedule_event and cancel_event to change existing ones (identify which by its start time + title, then use its event_id from get_calendar). get_calendar returns start/end already in Dean's LOCAL time — read them out verbatim, never re-adjust. Each event also has a 'navigate' field (a Waze link) when it has a location — share it when Dean asks how to get there or wants directions to a meeting. When BOOKING or MOVING an event, the NEW times you send MUST be UTC ISO 8601, and Dean speaks in local SAST (UTC+2), so convert down by 2 hours: e.g. "3pm Thursday" → that Thursday T13:00:00Z. Default meeting length 30 min if unstated. Pick the calendar from context (work-with-JIC-people → jic, Heya matters → heya); ask if ambiguous.
  • Reminders: when Dean says "remind me to X at/in Y", use set_reminder — DeanOS will Telegram him the reminder at that time. Convert his local SAST time to UTC. This is a timed nudge, distinct from a task (Todoist) or a calendar event; use it for "ping me at 3pm" style asks. list_reminders / cancel_reminder to review or drop them. Confirm the local time back to him ("Done — I'll ping you at 15:00.").
  • Email (Dean's live Outlook — Heya + JIC, kept strictly separate): search_email for ANY email question (it reads the real mailbox, full history), read_email for a full message. To reply or write: compose the message yourself in DEAN'S VOICE (see the voice guide below — short, direct, closes with "Thanks,"), SHOW HIM THE DRAFT, and only call send_email_reply / send_email once he has explicitly approved sending — never send unprompted, and never claim you sent something you didn't. Pick the mailbox from context; if a message is in Heya, reply from Heya. If search_email reports a mailbox isn't connected for email, tell Dean to reconnect it in Settings to grant email access. (find_emails/draft_email_reply remain for the older forwarded-inbox flow.)
  • remember for durable notes/person facts.
- When Dean refers to something by description ("that artwork task", "the payroll risk", "what Lawrence owes me"), use the matching find_ tool to locate the right id, then act. If several plausibly match, ask which one.
- Infer the business from context; if truly unclear, ask one short question instead of guessing. Never invent due dates — only set one if Dean stated it.
- After acting, confirm briefly and specifically what you did (e.g. "Done — marked the artwork task complete in Todoist.").
- Never fabricate facts, people, or commitments. If you don't know, say so.

DEAN'S VOICE (use when drafting emails, replies, or any message written as Dean):
${DEAN_VOICE}

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
    case "update_person": {
      const existing = await findPersonByName(str(args.name));
      const person = existing ?? (await getOrCreatePersonByName(owner.user.id, str(args.name)));
      const opt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
      const updated = await updatePerson(person.id, {
        role: opt(args.role),
        organization: opt(args.organization),
        email: opt(args.email),
        phone: opt(args.phone),
        notes: opt(args.notes),
      });
      return JSON.stringify({ ok: true, updated: updated?.full_name ?? str(args.name) });
    }
    case "get_calendar": {
      const days = typeof args.days === "number" ? args.days : 7;
      const events = await getUpcoming(owner.user.id, days);
      if (events.length === 0) {
        const conns = await listCalendarConnections(owner.user.id);
        return JSON.stringify({
          events: [],
          note: conns.length === 0 ? "No calendars connected yet (Settings → Calendars)." : "Nothing scheduled in that window.",
        });
      }
      return JSON.stringify({
        timezone: "All times below are Dean's LOCAL time (Africa/Johannesburg, SAST). Read them out verbatim — do NOT add or subtract any hours.",
        events: events.map((e) => ({
          calendar: e.calendar,
          event_id: e.source_uid,
          title: e.title,
          start: formatLocal(e.starts_at),
          end: e.ends_at ? formatLocal(e.ends_at) : null,
          all_day: e.all_day,
          location: e.location,
          navigate: e.location ? wazeLink(e.location) : null,
          attendees: e.attendees,
        })),
      });
    }
    case "create_event": {
      const calendar = str(args.calendar) as "heya" | "jic";
      const token = await getValidAccessToken(owner.user.id, calendar);
      if (!token) return JSON.stringify({ ok: false, error: `${calendar} calendar isn't connected.` });
      try {
        const created = await createEvent(token, {
          subject: str(args.title),
          startIso: str(args.start_utc),
          endIso: str(args.end_utc),
          attendees: Array.isArray(args.attendees) ? (args.attendees as string[]) : [],
          location: typeof args.location === "string" ? args.location : null,
        });
        const business = biz(calendar);
        await syncCalendar(owner.user.id, calendar, business?.id ?? null).catch(() => {});
        return JSON.stringify({ ok: true, created: str(args.title), calendar, link: created.webLink });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "create failed" });
      }
    }
    case "reschedule_event": {
      const calendar = str(args.calendar) as "heya" | "jic";
      const token = await getValidAccessToken(owner.user.id, calendar);
      if (!token) return JSON.stringify({ ok: false, error: `${calendar} calendar isn't connected.` });
      try {
        await updateEvent(token, str(args.event_id), {
          startIso: str(args.start_utc),
          endIso: str(args.end_utc),
        });
        const business = biz(calendar);
        await syncCalendar(owner.user.id, calendar, business?.id ?? null).catch(() => {});
        return JSON.stringify({ ok: true, rescheduled: true });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "reschedule failed" });
      }
    }
    case "cancel_event": {
      const calendar = str(args.calendar) as "heya" | "jic";
      const token = await getValidAccessToken(owner.user.id, calendar);
      if (!token) return JSON.stringify({ ok: false, error: `${calendar} calendar isn't connected.` });
      try {
        await deleteEvent(token, str(args.event_id));
        const business = biz(calendar);
        await syncCalendar(owner.user.id, calendar, business?.id ?? null).catch(() => {});
        return JSON.stringify({ ok: true, cancelled: true });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "cancel failed" });
      }
    }
    case "set_reminder": {
      const r = await createReminder(str(args.text), str(args.remind_at_utc));
      if (!r.ok) return JSON.stringify({ ok: false, error: r.error });
      return JSON.stringify({ ok: true, reminder: str(args.text), when_local: r.when, id: r.id });
    }
    case "list_reminders": {
      const rems = await listUpcomingReminders();
      return JSON.stringify(rems.map((r) => ({ id: r.id, text: r.text, when_local: r.when })));
    }
    case "cancel_reminder": {
      const ok = await cancelReminder(str(args.id));
      return JSON.stringify({ ok, error: ok ? undefined : "not found or already sent" });
    }
    case "search_email": {
      const which = str(args.mailbox) || "both";
      const boxes = which === "both" ? (["heya", "jic"] as const) : ([which] as ("heya" | "jic")[]);
      const query = typeof args.query === "string" && args.query.trim() ? args.query.trim() : undefined;
      const days = typeof args.days === "number" ? args.days : null;
      const sinceIso = !query && days ? new Date(Date.now() - days * 86400_000).toISOString() : undefined;
      const results: Array<GraphMessage & { mailbox: string }> = [];
      const errors: string[] = [];
      for (const box of boxes) {
        const token = await getValidAccessToken(owner.user.id, box);
        if (!token) {
          errors.push(`${box} not connected`);
          continue;
        }
        try {
          const msgs = await searchMessages(token, { query, sinceIso, top: 12 });
          results.push(...msgs.map((m) => ({ ...m, mailbox: box })));
        } catch (err) {
          errors.push(`${box}: ${err instanceof Error ? err.message : "search failed"}`);
        }
      }
      results.sort((a, b) => (b.receivedIso || "").localeCompare(a.receivedIso || ""));
      return JSON.stringify({
        emails: results.slice(0, 20).map((m) => ({
          mailbox: m.mailbox,
          message_id: m.id,
          from: m.from,
          subject: m.subject,
          received: m.receivedIso,
          preview: m.preview,
        })),
        errors: errors.length ? errors : undefined,
        note: errors.length
          ? "Some mailboxes aren't connected for email yet — Dean may need to reconnect them in Settings to grant email access."
          : undefined,
      });
    }
    case "read_email": {
      const box = str(args.mailbox) as "heya" | "jic";
      const token = await getValidAccessToken(owner.user.id, box);
      if (!token) return JSON.stringify({ ok: false, error: `${box} not connected for email` });
      const msg = await getMessageBody(token, str(args.message_id));
      if (!msg) return JSON.stringify({ ok: false, error: "couldn't read that email (reconnect email access?)" });
      return JSON.stringify({ ok: true, ...msg });
    }
    case "send_email_reply": {
      const box = str(args.mailbox) as "heya" | "jic";
      const token = await getValidAccessToken(owner.user.id, box);
      if (!token) return JSON.stringify({ ok: false, error: `${box} not connected for email` });
      try {
        const html = box === "heya" ? withHeyaSignature(str(args.body)) : undefined;
        await replyToMessage(token, str(args.message_id), str(args.body), html);
        return JSON.stringify({ ok: true, sent: true, mailbox: box, signature: box === "heya" });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "send failed" });
      }
    }
    case "send_email": {
      const box = str(args.mailbox) as "heya" | "jic";
      const token = await getValidAccessToken(owner.user.id, box);
      if (!token) return JSON.stringify({ ok: false, error: `${box} not connected for email` });
      const to = Array.isArray(args.to) ? (args.to as string[]).filter(Boolean) : [];
      if (to.length === 0) return JSON.stringify({ ok: false, error: "no recipient" });
      try {
        const html = box === "heya" ? withHeyaSignature(str(args.body)) : undefined;
        await sendNewMessage(token, { to, subject: str(args.subject), body: str(args.body), html });
        return JSON.stringify({ ok: true, sent: true, mailbox: box, to, signature: box === "heya" });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "send failed" });
      }
    }
    case "find_emails": {
      const emails = await listEmails({ unresolvedOnly: true, limit: 20 });
      return JSON.stringify(
        emails.map((e) => ({
          email_id: e.id,
          from: e.sender,
          mailbox: e.mailbox,
          subject: e.subject,
          summary: e.summary,
          classification: e.classification,
          date: e.email_date,
        }))
      );
    }
    case "draft_email_reply": {
      const email = await getEmail(str(args.email_id));
      if (!email) return JSON.stringify({ ok: false, error: "email not found — call find_emails for ids" });
      const guidance = typeof args.guidance === "string" && args.guidance.trim() ? args.guidance.trim() : undefined;
      const draft = await draftReply(email, guidance);
      if (!draft) return JSON.stringify({ ok: false, error: "couldn't draft a reply just now" });
      return JSON.stringify({
        ok: true,
        to: email.sender,
        subject: /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`,
        draft,
        send_link: mailtoLink(senderAddress(email.sender), email.subject, draft),
        note: "Show Dean the draft to review. send_link opens his mail app pre-filled for one-tap send; direct sending isn't wired yet.",
      });
    }
    case "web_research": {
      const r = await research(str(args.query), "agent");
      return JSON.stringify({ ok: r.ok, findings: r.text });
    }
    case "remove_person": {
      const existing = await findPersonByName(str(args.name));
      if (!existing) return JSON.stringify({ ok: false, error: "no such person on file" });
      const ok = await deletePerson(existing.id);
      return JSON.stringify({ ok, removed: ok ? existing.full_name : undefined });
    }
    case "get_brief": {
      const b = await generateDailyBrief();
      return JSON.stringify({
        brief: b.text,
        note: "Send this brief to Dean as-is — it is already formatted (date, weather, calendar, tasks). Do not reformat or add sections.",
      });
    }
    case "find_tasks": {
      const tasks = await listActionableTasks();
      return JSON.stringify(
        tasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          due_date: t.due_date,
          business: owner.businesses.find((b) => b.id === t.business_id)?.key ?? null,
        }))
      );
    }
    case "update_task": {
      const task = await getTask(str(args.id));
      if (!task) return JSON.stringify({ ok: false, error: "task not found" });
      const business = typeof args.business === "string" ? biz(args.business) : undefined;
      const dueRaw = args.due_date;
      const dueDate =
        dueRaw === "none" ? null : typeof dueRaw === "string" && dueRaw ? dueRaw : undefined;
      const updated = await updateTaskFields(task.id, {
        title: typeof args.title === "string" && args.title ? args.title : undefined,
        priority: typeof args.priority === "number" ? args.priority : undefined,
        dueDate,
        businessId: business ? business.id : undefined,
      });
      // Push to Todoist if it already lives there.
      if (updated?.status === "created" && updated.todoist_task_id) {
        await executeUpdate({
          todoistTaskId: updated.todoist_task_id,
          title: typeof args.title === "string" && args.title ? args.title : undefined,
          priority: typeof args.priority === "number" ? args.priority : undefined,
          due_date: dueDate,
        });
      }
      return JSON.stringify({ ok: true, updated: updated?.title, priority: updated?.priority });
    }
    case "complete_task": {
      const task = await getTask(str(args.id));
      if (!task) return JSON.stringify({ ok: false, error: "task not found" });
      if (task.status === "created" && task.todoist_task_id) {
        const done = await executeComplete(task.todoist_task_id);
        if (done.ok) await completeTaskByTodoistId(task.todoist_task_id);
        else return JSON.stringify({ ok: false, error: `Todoist: ${done.error}` });
      } else {
        await setTaskStatus(task.id, "completed");
      }
      return JSON.stringify({ ok: true, completed: task.title });
    }
    case "approve_task": {
      const task = await getTask(str(args.id));
      if (!task) return JSON.stringify({ ok: false, error: "task not found" });
      const business = owner.businesses.find((b) => b.id === task.business_id) ?? null;
      await setTaskStatus(task.id, "approved");
      const sent = await executeCreate(task, business);
      if (!sent.ok) {
        await setTaskStatus(task.id, "failed", sent.error);
        return JSON.stringify({ ok: false, error: sent.error });
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
      return JSON.stringify({ ok: true, approved: task.title });
    }
    case "reject_task": {
      const task = await getTask(str(args.id));
      if (!task) return JSON.stringify({ ok: false, error: "task not found" });
      await setTaskStatus(task.id, "rejected", "Rejected via chat.");
      return JSON.stringify({ ok: true, rejected: task.title });
    }
    case "find_commitments": {
      const rows = await listOpenCommitmentsWithMeta();
      return JSON.stringify(rows);
    }
    case "resolve_commitment": {
      const c = await getCommitment(str(args.id));
      if (!c) return JSON.stringify({ ok: false, error: "commitment not found" });
      const status = (["done", "cancelled", "open"].includes(str(args.status)) ? args.status : "done") as
        | "done"
        | "cancelled"
        | "open";
      await updateCommitment(c.id, { status });
      if ((status === "done" || status === "cancelled") && c.linked_task_id) {
        const task = await getTask(c.linked_task_id);
        if (task?.status === "suggested" || task?.status === "approved") {
          await setTaskStatus(task.id, "rejected", "Commitment resolved via chat.");
        } else if (task?.status === "created" && task.todoist_task_id) {
          const done = await executeComplete(task.todoist_task_id);
          if (done.ok) await completeTaskByTodoistId(task.todoist_task_id);
        }
      }
      return JSON.stringify({ ok: true, commitment: c.text, status });
    }
    case "update_commitment": {
      const c = await getCommitment(str(args.id));
      if (!c) return JSON.stringify({ ok: false, error: "commitment not found" });
      await updateCommitment(c.id, {
        text: typeof args.text === "string" && args.text ? args.text : undefined,
        personName: typeof args.person === "string" ? args.person : undefined,
      });
      return JSON.stringify({ ok: true });
    }
    case "find_risks": {
      const rows = (await listRisks())
        .filter((r) => r.status === "open")
        .map((r) => ({ id: r.id, description: r.description, severity: r.severity, status: r.status }));
      return JSON.stringify(rows);
    }
    case "update_risk": {
      const r = await getRisk(str(args.id));
      if (!r) return JSON.stringify({ ok: false, error: "risk not found" });
      await updateRisk(r.id, {
        status: ["open", "mitigated", "closed"].includes(str(args.status)) ? (args.status as "open" | "mitigated" | "closed") : undefined,
        severity: ["low", "medium", "high"].includes(str(args.severity)) ? (args.severity as "low" | "medium" | "high") : undefined,
        description: typeof args.description === "string" && args.description ? args.description : undefined,
      });
      return JSON.stringify({ ok: true });
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

  const nowLocal = new Date().toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const conns = await listCalendarConnections(owner.user.id);
  const connectedCalendars = conns.length ? conns.map((c) => c.calendar).join(", ") : "none";
  const input: AgentInputItem[] = [
    { role: "system", content: systemPrompt(JSON.stringify(snapshot), snapshot.today, nowLocal, connectedCalendars) },
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
