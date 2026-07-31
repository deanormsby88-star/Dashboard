import { createHash, randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { callStructured } from "@/lib/ai/openai";
import {
  appendConversationMessage,
  getLastSyncRun,
  listCalendarConnections,
  listSyncRunsBySource,
  recordSyncRun,
} from "@/lib/db/repo";
import {
  getMessageBody,
  getValidAccessToken,
  listInboxMessages,
  listRecentTeamsMessages,
  listSentMessages,
} from "@/lib/calendar/microsoft";
import { sendToUserWithButtons } from "@/lib/telegram/notify";
import { deadlineLabel, reminderLadder, type ReminderRung } from "@/lib/deadlines/ladder";
import type { Owner } from "@/lib/db/repo";

const LOOKBACK_HOURS = 30;
const MAX_MESSAGES = 40;
const MIN_CONFIDENCE = 0.6;

interface MsgItem {
  id: string; // e.g. "inbox:AAA", "sent:BBB", "teams:CCC"
  source: string; // human label
  text: string;
  when: string; // ISO
  kind: "inbox" | "sent" | "teams";
  calendar?: "heya" | "jic"; // mailbox for full-body fetch (mail only)
  rawId?: string; // Graph message id, for full-body fetch
  subject?: string; // mail subject, prepended to the fetched body
}

interface ExtractedDeadline {
  ref: string;
  what: string;
  due_date: string; // YYYY-MM-DD
  due_time: string | null; // HH:MM or null
  confidence: number;
}

const SYSTEM = `You find explicit DEADLINES for Dean Ormsby in his recent Microsoft Teams messages and emails (inbox and things he sent).

A deadline is a concrete date (and optionally a time) by which something is due — e.g. "by Friday", "before 15 Aug", "EOD Thursday", "by 3pm tomorrow", "due end of month". Resolve relative dates against the CURRENT DATE given below, in South African time.

Rules:
- Only real, concrete deadlines. Ignore vague language ("soon", "asap", "when you can") unless an actual date is stated.
- due_date is YYYY-MM-DD. due_time is HH:MM (24-hour) ONLY if a specific time is given, otherwise null. "EOD"/"end of day" → null time (not a specific hour).
- "what" is a short description of what's due (verb-first where possible).
- ref must be the exact id of the message the deadline came from.
- confidence 0–1: how sure you are this is a genuine deadline.
- If there are no real deadlines, return an empty list.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["deadlines"],
  properties: {
    deadlines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "what", "due_date", "due_time", "confidence"],
        properties: {
          ref: { type: "string" },
          what: { type: "string" },
          due_date: { type: "string" },
          due_time: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const;

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

/** Gather recent Teams + inbox + sent messages across the owner's mailboxes. */
async function gatherMessages(owner: Owner, sinceIso: string): Promise<MsgItem[]> {
  const conns = await listCalendarConnections(owner.user.id);
  const items: MsgItem[] = [];
  for (const c of conns) {
    if (c.calendar !== "heya" && c.calendar !== "jic") continue;
    const token = await getValidAccessToken(owner.user.id, c.calendar);
    if (!token) continue;
    const box = c.calendar.toUpperCase();

    try {
      for (const m of await listInboxMessages(token, sinceIso, { top: 25 })) {
        items.push({ id: `inbox:${m.id}`, source: `Email (${box}) from ${m.from}`, when: m.receivedIso, text: `${m.subject}\n${m.preview}`, kind: "inbox", calendar: c.calendar, rawId: m.id, subject: m.subject });
      }
    } catch {
      /* mailbox unavailable — skip */
    }
    try {
      for (const m of await listSentMessages(token, sinceIso, 25)) {
        items.push({ id: `sent:${m.id}`, source: `Your sent mail (${box}) to ${m.to.join(", ") || "?"}`, when: m.sentIso, text: `${m.subject}\n${m.preview}`, kind: "sent", calendar: c.calendar, rawId: m.id, subject: m.subject });
      }
    } catch {
      /* skip */
    }
    if (c.calendar === "heya") {
      try {
        for (const m of await listRecentTeamsMessages(token, sinceIso, 15)) {
          items.push({ id: `teams:${m.id}`, source: `Teams — from ${m.from}${m.chatTopic ? ` in “${m.chatTopic}”` : ""}`, when: m.createdIso, text: m.text, kind: "teams" });
        }
      } catch {
        /* Teams not consented — skip */
      }
    }
  }
  return items;
}

/**
 * Replace mail items' preview text with their full body. Only called for the
 * fresh batch, and grouped by mailbox so each token is resolved once — so this
 * is bounded to the handful of new messages since the last scan.
 */
async function enrichMailBodies(owner: Owner, items: MsgItem[]): Promise<void> {
  const mail = items.filter((it) => it.calendar && it.rawId);
  const byBox = new Map<"heya" | "jic", MsgItem[]>();
  for (const it of mail) {
    const list = byBox.get(it.calendar!) ?? [];
    list.push(it);
    byBox.set(it.calendar!, list);
  }
  for (const [calendar, list] of byBox) {
    const token = await getValidAccessToken(owner.user.id, calendar);
    if (!token) continue;
    for (const it of list) {
      try {
        const full = await getMessageBody(token, it.rawId!);
        if (full?.body) it.text = `${it.subject ?? full.subject}\n${full.body}`;
      } catch {
        /* keep the preview if the full fetch fails */
      }
    }
  }
}

/** Ask the model to pull concrete deadlines from a batch of messages. */
async function extractDeadlines(batch: MsgItem[], now: Date): Promise<ExtractedDeadline[]> {
  const nowSast = now.toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const user = `CURRENT DATE/TIME (South African time): ${nowSast}

Messages:
${batch.map((m) => `[${m.id}] ${m.source}\n${m.text.slice(0, 4000)}`).join("\n\n---\n\n")}`;

  const res = await callStructured({
    model: getEnv().OPENAI_MODEL_EMAIL_PROCESSOR,
    system: SYSTEM,
    user,
    schemaName: "deadlines",
    jsonSchema: SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: 1200,
  });
  if (!res.ok || !res.rawText) return [];
  try {
    const parsed = JSON.parse(res.rawText) as { deadlines?: ExtractedDeadline[] };
    return parsed.deadlines ?? [];
  } catch {
    return [];
  }
}

// ── Pending deadline suggestions (staged on sync_runs, mirrors email/pending) ──

export interface PendingDeadline {
  id: string;
  what: string;
  dueLabel: string;
  source: string;
  rungs: ReminderRung[];
}

export async function getPendingDeadline(id: string): Promise<PendingDeadline | null> {
  if (await getLastSyncRun(`pendingdldone:${id}`)) return null;
  const rows = await listSyncRunsBySource(`pendingdl:${id}`, 7);
  const s = rows[0]?.stats as unknown as PendingDeadline | undefined;
  return s?.rungs?.length ? s : null;
}

export async function markDeadlineDone(owner: Owner, id: string): Promise<void> {
  await recordSyncRun({ userId: owner.user.id, sourceSystem: `pendingdldone:${id}`, stats: {} });
}

/**
 * Scan recent Teams + email for concrete deadlines and, for each new one,
 * suggest the reminder ladder (day before / on the day / hour before) with
 * one-tap buttons. Each message is scanned once; each deadline suggested once.
 */
export async function scanDeadlines(owner: Owner, now: Date = new Date()): Promise<{ suggested: number; scanned: number }> {
  const sinceIso = new Date(now.getTime() - LOOKBACK_HOURS * 3600_000).toISOString();
  const all = await gatherMessages(owner, sinceIso);

  // Only look at messages we haven't scanned before.
  const fresh: MsgItem[] = [];
  for (const it of all) {
    if (await getLastSyncRun(`dlseen:${hash(it.id)}`)) continue;
    fresh.push(it);
  }
  if (!fresh.length) return { suggested: 0, scanned: 0 };
  const batch = fresh.slice(0, MAX_MESSAGES);

  // Read the full email bodies (not just previews) for airtight coverage.
  await enrichMailBodies(owner, batch);

  const deadlines = await extractDeadlines(batch, now);
  for (const it of batch) {
    await recordSyncRun({ userId: owner.user.id, sourceSystem: `dlseen:${hash(it.id)}`, stats: {} });
  }

  const byId = new Map(batch.map((m) => [m.id, m]));
  let suggested = 0;
  for (const d of deadlines) {
    if (!d.what?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(d.due_date) || d.confidence < MIN_CONFIDENCE) continue;
    const dupKey = hash(`${d.what.toLowerCase()}|${d.due_date}|${d.due_time ?? ""}`);
    if (await getLastSyncRun(`dlsug:${dupKey}`)) continue;

    const time = d.due_time && /^\d{2}:\d{2}$/.test(d.due_time) ? d.due_time : null;
    const rungs = reminderLadder(d.due_date, time, now);
    if (!rungs.length) continue; // deadline passed or no future reminders left

    const src = byId.get(d.ref)?.source ?? "a message";
    const dueLabel = deadlineLabel(d.due_date, time);
    const id = randomUUID().slice(0, 8);
    await recordSyncRun({
      userId: owner.user.id,
      sourceSystem: `pendingdl:${id}`,
      stats: { id, what: d.what.trim(), dueLabel, source: src, rungs },
    });

    const lines = [
      `📅 Deadline spotted`,
      `“${d.what.trim()}” — due ${dueLabel}`,
      `Source: ${src}`,
      ``,
      `Suggested reminders:`,
      ...rungs.map((r) => `• ${r.label}`),
    ];
    const ok = await sendToUserWithButtons(owner.user.id, lines.join("\n"), [
      [
        { text: `🔔 Set ${rungs.length === 1 ? "reminder" : `all ${rungs.length}`}`, callback_data: `dl:all:${id}` },
        { text: "📆 On the day only", callback_data: `dl:day:${id}` },
      ],
      [{ text: "✖️ Ignore", callback_data: `dl:no:${id}` }],
    ]);
    if (ok) {
      await recordSyncRun({ userId: owner.user.id, sourceSystem: `dlsug:${dupKey}`, stats: { what: d.what } });
      await appendConversationMessage({ userId: owner.user.id, channel: "telegram", role: "assistant", content: lines.join("\n") });
      suggested++;
    }
  }
  return { suggested, scanned: batch.length };
}
