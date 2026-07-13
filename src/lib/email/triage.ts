import { getEnv } from "@/lib/env";
import { callText } from "@/lib/ai/openai";
import { appendConversationMessage, ensureOwner, getLastSyncRun, listCalendarConnections, recordSyncRun } from "@/lib/db/repo";
import { getValidAccessToken, listInboxMessages, type GraphMessage } from "@/lib/calendar/microsoft";
import { sendToDean } from "@/lib/telegram/notify";

const LOOKBACK_HOURS = 36;

const TRIAGE_SYSTEM = `You are Dean Ormsby's chief of staff triaging his unread email. From the messages below, produce a short, prioritised list of what actually needs him — most important first, one line each: sender + what it's about + a suggested action (reply / task / read / FYI). Group or omit newsletters, notifications, automated reports and other noise. Be concise and specific; no preamble, no markdown headers. If nothing genuinely needs him, say the inbox is clear. End with: reply here to act on any of them (e.g. "reply to the Anchor one").`;

function localToday(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

/**
 * Send Dean a morning inbox triage: unread mail across Heya + JIC, distilled by
 * the model into what needs him with suggested actions. Once per local day.
 */
export async function morningTriage(now: Date = new Date()): Promise<{ status: string; count?: number }> {
  const owner = await ensureOwner();

  const dedupKey = `triage:${localToday(now)}`;
  if (await getLastSyncRun(dedupKey)) return { status: "already_sent" };

  const conns = await listCalendarConnections(owner.user.id);
  const sinceIso = new Date(now.getTime() - LOOKBACK_HOURS * 3600_000).toISOString();
  const all: Array<GraphMessage & { mailbox: string }> = [];
  for (const c of conns) {
    if (c.calendar !== "heya" && c.calendar !== "jic") continue;
    const token = await getValidAccessToken(owner.user.id, c.calendar);
    if (!token) continue;
    try {
      const msgs = await listInboxMessages(token, sinceIso, { unreadOnly: true, top: 25 });
      all.push(...msgs.map((m) => ({ ...m, mailbox: c.calendar })));
    } catch {
      /* skip this mailbox */
    }
  }
  if (all.length === 0) return { status: "empty" };

  const list = all
    .map((m) => `- [${m.mailbox}] from ${m.from} — ${m.subject}${m.preview ? ` :: ${m.preview.slice(0, 140)}` : ""}`)
    .join("\n");
  const res = await callText({
    model: getEnv().OPENAI_MODEL_PRIORITIZER,
    system: TRIAGE_SYSTEM,
    user: `Unread emails (${all.length}):\n${list}`,
    maxOutputTokens: 900,
  });
  if (!res.ok || !res.rawText?.trim()) return { status: "ai_failed" };

  const msg = `📥 Inbox triage — ${all.length} unread\n\n${res.rawText.trim()}`;
  const ok = await sendToDean(msg);
  if (ok) {
    await recordSyncRun({ userId: owner.user.id, sourceSystem: dedupKey, stats: { count: all.length } });
    await appendConversationMessage({ userId: owner.user.id, channel: "telegram", role: "assistant", content: msg });
  }
  return { status: "sent", count: all.length };
}
