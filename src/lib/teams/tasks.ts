import { createHash } from "node:crypto";
import { getEnv } from "@/lib/env";
import { callStructured } from "@/lib/ai/openai";
import { normalizeTitle } from "@/lib/dedup";
import {
  businessByKey,
  ensureOwner,
  getLastSyncRun,
  insertTask,
  recordSyncRun,
} from "@/lib/db/repo";
import { getMyId, getValidAccessToken, listRecentTeamsMessages } from "@/lib/calendar/microsoft";

const LOOKBACK_HOURS = 26;
const MAX_MESSAGES = 40;

/** Format a message timestamp in Dean's local time for the task note. */
function fmtSent(iso: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const SYSTEM = `You extract concrete, actionable tasks FOR DEAN ORMSBY from his recent Microsoft Teams messages (his team at Heya). Only genuine action items that Dean owns or is being asked to do — ignore chit-chat, FYIs, greetings, and things other people own. Title each task verb-first and concise. priority: 4 urgent, 3 important, 2 normal, 1 low. due_date is YYYY-MM-DD only if a date is explicitly stated, else null. Set message_id to the id of the message the task came from. If there are no real tasks, return an empty list.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tasks"],
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["message_id", "title", "priority", "due_date"],
        properties: {
          message_id: { type: "string" },
          title: { type: "string" },
          priority: { type: "integer", minimum: 1, maximum: 4 },
          due_date: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

/**
 * Scan Dean's recent Teams messages and turn genuine action items into
 * suggested tasks (which then flow to the Telegram approve buttons). Each
 * message is scanned once (sync_runs), and tasks dedupe on message + title.
 */
export async function scanTeamsForTasks(now: Date = new Date()): Promise<{ scanned: number; created: number }> {
  const owner = await ensureOwner();
  const token = await getValidAccessToken(owner.user.id, "heya");
  if (!token) return { scanned: 0, created: 0 };

  const myId = await getMyId(token);
  const sinceIso = new Date(now.getTime() - LOOKBACK_HOURS * 3600_000).toISOString();

  let all;
  try {
    all = await listRecentTeamsMessages(token, sinceIso);
  } catch {
    return { scanned: 0, created: 0 };
  }

  // Only unseen messages from other people.
  const fresh = [];
  for (const m of all) {
    if (myId && m.fromId === myId) continue;
    if (await getLastSyncRun(`teamsmsg:${m.id}`)) continue;
    fresh.push(m);
  }
  if (fresh.length === 0) return { scanned: 0, created: 0 };
  const batch = fresh.slice(0, MAX_MESSAGES);

  const user = batch
    .map((m) => `[${m.id}] ${m.from}${m.chatTopic ? ` in "${m.chatTopic}"` : ""}: ${m.text}`)
    .join("\n");
  const res = await callStructured({
    model: getEnv().OPENAI_MODEL_EMAIL_PROCESSOR,
    system: SYSTEM,
    user,
    schemaName: "teams_tasks",
    jsonSchema: SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: 900,
  });

  let created = 0;
  if (res.ok && res.rawText) {
    let parsed: { tasks?: Array<{ message_id: string; title: string; priority: number; due_date: string | null }> } | null = null;
    try {
      parsed = JSON.parse(res.rawText);
    } catch {
      parsed = null;
    }
    const heya = businessByKey(owner, "heya");
    const byId = new Map(batch.map((m) => [m.id, m]));
    for (const t of parsed?.tasks ?? []) {
      if (!t.title?.trim()) continue;
      const dedupKey = createHash("sha256").update(`teams:${t.message_id}:${normalizeTitle(t.title)}`).digest("hex");
      const src = byId.get(t.message_id);
      const sender = src?.from && src.from !== "(unknown)" ? src.from : "a teammate";
      const sentAt = src?.createdIso ? fmtSent(src.createdIso) : null;
      const inChat = src?.chatTopic ? ` in “${src.chatTopic}”` : "";
      const description = `From ${sender} on Teams${inChat}${sentAt ? ` — sent ${sentAt}` : ""}.`;
      const { task } = await insertTask({
        userId: owner.user.id,
        businessId: heya?.id ?? null,
        meetingId: null,
        title: t.title.trim(),
        description,
        priority: [1, 2, 3, 4].includes(t.priority) ? t.priority : 2,
        dueDate: typeof t.due_date === "string" ? t.due_date : null,
        labels: [],
        origin: "action_item",
        confidence: null,
        sourceSystem: "teams",
        sourceRecordId: t.message_id,
        sourceUrl: null,
        dedupKey,
        aiRunId: null,
      });
      if (task) created++;
    }
  }

  // Mark every scanned message so we don't re-process it.
  for (const m of batch) {
    await recordSyncRun({ userId: owner.user.id, sourceSystem: `teamsmsg:${m.id}`, stats: {} });
  }
  return { scanned: batch.length, created };
}
