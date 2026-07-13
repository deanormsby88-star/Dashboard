import { getEnv } from "@/lib/env";
import { callText } from "@/lib/ai/openai";
import { DEAN_VOICE } from "@/lib/voice";
import {
  appendConversationMessage,
  ensureOwner,
  getLastSyncRun,
  getMeetingAttendees,
  listCommitmentsForMeeting,
  listMeetings,
  recordSyncRun,
} from "@/lib/db/repo";
import { sendToDean } from "@/lib/telegram/notify";

const RECENT_HOURS = 26;

const FOLLOWUP_SYSTEM = `You draft a short post-meeting follow-up email for Dean Ormsby to send the attendees.

${DEAN_VOICE}

Recap the key decisions and the next steps / who owes what, briefly. Return ONLY the email body. Don't invent anything beyond the notes provided.`;

/**
 * After a meeting is processed, nudge Dean with a ready-to-send follow-up draft
 * (recap + next steps) and a reminder that its tasks are queued for approval.
 * Once per meeting.
 */
export async function notifyMeetingFollowups(now: Date = new Date()): Promise<{ sent: number }> {
  const owner = await ensureOwner();
  const meetings = await listMeetings(15);

  let sent = 0;
  for (const m of meetings) {
    if (m.processing_status !== "processed" || !m.meeting_date) continue;
    if (now.getTime() - new Date(m.meeting_date).getTime() > RECENT_HOURS * 3600_000) continue;
    const key = `mtgfollowup:${m.id}`;
    if (await getLastSyncRun(key)) continue;

    const [attendees, commitments] = await Promise.all([
      getMeetingAttendees(m.id),
      listCommitmentsForMeeting(m.id),
    ]);
    const people = attendees.map((a) => a.name || a.email).filter(Boolean);

    const ctx = `Meeting: ${m.title}
Summary: ${m.summary ?? "(none)"}
Commitments:
${commitments.map((c) => `- ${c.direction === "by_dean" ? "you owe" : "they owe"}: ${c.text}${c.person_name ? ` (${c.person_name})` : ""}`).join("\n") || "- none recorded"}`;
    const res = await callText({
      model: getEnv().OPENAI_MODEL_PRIORITIZER,
      system: FOLLOWUP_SYSTEM,
      user: ctx,
      maxOutputTokens: 500,
    });
    const draft = res.ok ? res.rawText?.trim() : null;

    const lines = [`📝 “${m.title}” wrapped.`];
    if (people.length) lines.push(`With: ${people.slice(0, 6).join(", ")}`);
    lines.push(`Any tasks from it are queued for your approval.`);
    if (draft) lines.push(`\nDraft follow-up:\n${draft}`);
    lines.push(`\nSay “send the follow-up” and I’ll email the attendees.`);

    const msg = lines.join("\n");
    const ok = await sendToDean(msg);
    if (ok) {
      await recordSyncRun({ userId: owner.user.id, sourceSystem: key, stats: { title: m.title } });
      await appendConversationMessage({ userId: owner.user.id, channel: "telegram", role: "assistant", content: msg });
      sent++;
    }
  }
  return { sent };
}
