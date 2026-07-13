import { businessDaysBetween } from "@/lib/dates";
import { appendConversationMessage, ensureOwner, getLastSyncRun, listCalendarConnections, recordSyncRun } from "@/lib/db/repo";
import { getAccountEmail, getValidAccessToken, latestInConversation, listSentMessages } from "@/lib/calendar/microsoft";
import { sendToDean } from "@/lib/telegram/notify";

const LOOKBACK_DAYS = 14;
const WAIT_BUSINESS_DAYS = 3;
const COOLDOWN_HOURS = 48; // re-nudge at most every 2 days per thread

/**
 * Find emails Dean sent that still have no reply after a few business days and
 * nudge him. "No reply" = the latest message in the conversation is still from
 * Dean. He can then say "chase them" and the agent drafts/sends the follow-up.
 */
export async function notifyAwaitingReplies(now: Date = new Date()): Promise<{ sent: number; checked: number }> {
  const owner = await ensureOwner();
  const conns = await listCalendarConnections(owner.user.id);
  const sinceIso = new Date(now.getTime() - LOOKBACK_DAYS * 86400_000).toISOString();

  let sent = 0;
  let checked = 0;
  for (const c of conns) {
    if (c.calendar !== "heya" && c.calendar !== "jic") continue;
    const token = await getValidAccessToken(owner.user.id, c.calendar);
    if (!token) continue;
    const me = ((await getAccountEmail(token)) ?? "").toLowerCase();

    let sentMsgs;
    try {
      sentMsgs = await listSentMessages(token, sinceIso, 40);
    } catch {
      continue;
    }

    // One entry per conversation — the most recent thing Dean sent in it.
    const byConv = new Map<string, (typeof sentMsgs)[number]>();
    for (const m of sentMsgs) if (m.conversationId && !byConv.has(m.conversationId)) byConv.set(m.conversationId, m);

    for (const m of byConv.values()) {
      const waitDays = businessDaysBetween(new Date(m.sentIso), now);
      if (waitDays < WAIT_BUSINESS_DAYS) continue;
      checked++;
      const latest = await latestInConversation(token, m.conversationId);
      if (!latest) continue;
      // A reply arrived if the latest message is from someone other than Dean.
      if (latest.fromAddress && me && latest.fromAddress.toLowerCase() !== me) continue;

      const key = `awaiting:${c.calendar}:${m.conversationId}`;
      const last = await getLastSyncRun(key);
      if (last && now.getTime() - last.getTime() < COOLDOWN_HOURS * 3600_000) continue;

      const msg = `⏳ No reply yet — “${m.subject}”\nSent to ${m.to.join(", ") || "?"} · ${waitDays} business days ago (${c.calendar})\nSay “chase them” and I’ll draft a nudge.`;
      const ok = await sendToDean(msg);
      if (ok) {
        await recordSyncRun({ userId: owner.user.id, sourceSystem: key, stats: { subject: m.subject } });
        await appendConversationMessage({ userId: owner.user.id, channel: "telegram", role: "assistant", content: msg });
        sent++;
      }
    }
  }
  return { sent, checked };
}
