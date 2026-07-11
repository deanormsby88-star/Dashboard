import { getEnv } from "@/lib/env";
import { callText } from "@/lib/ai/openai";
import { getPersonBundle, type CalendarEventRow } from "@/lib/db/repo";

/** How many attendees to research for a prep pack (bounds latency/tokens). */
const MAX_ATTENDEES = 4;

/**
 * Assemble the internal context DeanOS holds on a meeting's attendees:
 * who they are, what each owes whom, when they last met, recent email.
 * Returns null when there's genuinely nothing on file (caller falls back to a
 * plain nudge).
 */
async function gatherContext(event: CalendarEventRow): Promise<string | null> {
  const attendees = event.attendees.slice(0, MAX_ATTENDEES);
  if (attendees.length === 0) return null;

  const bundles = await Promise.all(attendees.map((a) => getPersonBundle(a).catch(() => null)));
  let known = false;
  const blocks = attendees.map((a, i) => {
    const b = bundles[i];
    const lines: string[] = [];
    if (b?.person?.role || b?.person?.organization) {
      lines.push(`role: ${[b?.person?.role, b?.person?.organization].filter(Boolean).join(", ")}`);
    }
    const open = (b?.commitments ?? []).filter((c) => c.status === "open").slice(0, 4);
    if (open.length) {
      lines.push(
        `open items: ${open
          .map((c) => `${c.direction === "by_dean" ? "you owe them" : "they owe you"} — ${c.text}`)
          .join("; ")}`
      );
    }
    const lastMeeting = b?.meetings?.[0];
    if (lastMeeting) lines.push(`last met: ${lastMeeting.title}${lastMeeting.summary ? ` — ${lastMeeting.summary}` : ""}`);
    const lastEmail = b?.emails?.[0];
    if (lastEmail) lines.push(`recent email: ${lastEmail.subject}`);
    if (lines.length) known = true;
    return `${a}:\n  ${lines.length ? lines.join("\n  ") : "(no history on file)"}`;
  });

  if (!known) return null;
  return blocks.join("\n");
}

const PREP_SYSTEM = `You are DeanOS, Dean Ormsby's chief of staff, writing a quick pre-meeting prep for a Telegram message. Be concise and practical — Dean reads this walking into the room.

Given the meeting and what we know about the attendees, produce:
1. The single most important OUTCOME to drive in this meeting.
2. 2–3 short talking points or things to raise (fold in any open items each party owes the other).
3. If useful, one question worth asking.

Plain text, no markdown headers. Tight — a handful of lines. Don't invent facts not supported by the context; if context is thin, keep it to a crisp objective and note that background is light.`;

/**
 * Build a pre-meeting prep pack for Telegram, or null if there isn't enough
 * on file to be worth more than a plain reminder.
 */
export async function buildMeetingPrep(event: CalendarEventRow): Promise<string | null> {
  const context = await gatherContext(event);
  if (!context) return null;

  const model = getEnv().OPENAI_MODEL_PRIORITIZER;
  const user = `Meeting: "${event.title}"${event.location ? ` at ${event.location}` : ""}.
Attendees and what we know:
${context}`;
  const res = await callText({ model, system: PREP_SYSTEM, user, maxOutputTokens: 500 });
  if (!res.ok || !res.rawText?.trim()) return null;
  return res.rawText.trim();
}
